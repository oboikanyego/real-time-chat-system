import { Types } from 'mongoose';
import { Conversation } from '../models/conversation.model';
import { Message } from '../models/message.model';
import { User } from '../models/user.model';
import { AppError } from '../middleware/error';
import { isOnline } from '../socket/presence';
import { toDirectoryEntry } from './directory.service';

export const directKeyFor = (a: Types.ObjectId | string, b: Types.ObjectId | string) => [String(a), String(b)].sort().join(':');

export type Cursors = Record<string, { deliveredUpTo?: unknown; readUpTo?: unknown } | undefined>;

type ConversationRecord = {
  _id: unknown;
  type: string;
  participants: unknown[];
  lastMessage?: { text?: string | null; senderId?: unknown; sentAt?: Date | null; messageId?: unknown } | null;
  lastMessageAt?: Date | null;
  cursors?: Cursors | null;
  createdAt: Date;
};

/** A directory entry plus presence, which is only shared once the two have exchanged a message. */
export type Participant = ReturnType<typeof toDirectoryEntry> & { presence: { online: boolean; lastSeenAt: Date | null } | null };

export function toParticipant(user: { _id: unknown; displayName: string; photoURL?: string | null; lastSeenAt?: Date | null }, established: boolean): Participant {
  return {
    ...toDirectoryEntry(user),
    // Presence is withheld until a message exists, so merely opening a chat cannot be used to watch someone.
    presence: established ? { online: isOnline(user._id), lastSeenAt: user.lastSeenAt ?? null } : null
  };
}

const idOrNull = (value: unknown) => (value ? String(value) : null);

export const cursorOf = (conversation: { cursors?: Cursors | null }, userId: unknown) => conversation.cursors?.[String(userId)];

const otherParticipant = (conversation: { participants: unknown[] }, userId: unknown) =>
  conversation.participants.find((id) => String(id) !== String(userId));

/** The conversation as the caller sees it: the other participant is inlined, plus unread count and the peer's receipts. */
export function toConversationView(
  conversation: ConversationRecord,
  viewerId: Types.ObjectId | string,
  people: Map<string, Participant>,
  unreadCount = 0
) {
  const otherId = String(otherParticipant(conversation, viewerId) ?? '');
  const peer = cursorOf(conversation, otherId);
  const last = conversation.lastMessage;
  return {
    id: String(conversation._id),
    type: conversation.type,
    participant: people.get(otherId) ?? { id: otherId, displayName: 'Unknown user', photoURL: null, presence: null },
    lastMessage: last?.sentAt
      ? { id: idOrNull(last.messageId), text: last.text ?? '', senderId: String(last.senderId), sentAt: last.sentAt }
      : null,
    lastMessageAt: conversation.lastMessageAt ?? null,
    unreadCount,
    peerReceipts: { deliveredUpTo: idOrNull(peer?.deliveredUpTo), readUpTo: idOrNull(peer?.readUpTo) },
    createdAt: conversation.createdAt
  };
}

const UNREAD_CAP = 100;

/** Messages from the other person after the viewer's read cursor (capped; the UI shows "99+"). */
export async function countUnread(conversation: ConversationRecord, viewerId: unknown): Promise<number> {
  if (!conversation.lastMessageAt) return 0;
  const readUpTo = cursorOf(conversation, viewerId)?.readUpTo;
  return Message.countDocuments(
    { conversationId: conversation._id, senderId: { $ne: viewerId }, ...(readUpTo ? { _id: { $gt: readUpTo } } : {}) },
    { limit: UNREAD_CAP }
  );
}

export async function loadPeople(conversations: ConversationRecord[], viewerId: Types.ObjectId) {
  const established = new Map<string, boolean>();
  for (const c of conversations) {
    const other = otherParticipant(c, viewerId);
    if (other) established.set(String(other), !!c.lastMessageAt);
  }
  const users = await User.find({ _id: { $in: [...established.keys()] } }, { displayName: 1, photoURL: 1, lastSeenAt: 1 }).lean();
  return new Map(users.map((u) => [String(u._id), toParticipant(u, established.get(String(u._id)) ?? false)]));
}

/** View with the unread count filled in. */
export async function buildView(conversation: ConversationRecord, viewerId: Types.ObjectId, people: Map<string, Participant>) {
  return toConversationView(conversation, viewerId, people, await countUnread(conversation, viewerId));
}

/** Participant-only lookup; a missing conversation and someone else's look identical. */
export async function requireParticipation(callerId: Types.ObjectId, conversationId: string) {
  const conversation = Types.ObjectId.isValid(conversationId)
    ? await Conversation.findOne({ _id: conversationId, participants: callerId }).lean()
    : null;
  if (!conversation) throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found.');
  return conversation;
}

/** Opens (creating if needed) the direct conversation between the caller and another user. */
export async function openDirectConversation(callerId: Types.ObjectId, otherUserId: string) {
  if (String(callerId) === otherUserId) throw new AppError(400, 'INVALID_PARTICIPANT', 'You cannot start a conversation with yourself.');

  const other = await User.findById(otherUserId, { displayName: 1, photoURL: 1, lastSeenAt: 1 }).lean();
  if (!other) throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');

  const directKey = directKeyFor(callerId, other._id);
  const open = () =>
    Conversation.findOneAndUpdate(
      { directKey },
      { $setOnInsert: { type: 'direct', participants: [callerId, other._id], directKey }, $addToSet: { openedBy: callerId } },
      { upsert: true, new: true, includeResultMetadata: true }
    );

  let result;
  try {
    result = await open();
  } catch (error) {
    // A concurrent request created it first; the unique directKey turns that into a plain lookup.
    if ((error as { code?: number }).code !== 11000) throw error;
    result = await open();
  }

  const conversation = result.value!.toObject();
  const created = !result.lastErrorObject?.updatedExisting;
  const people = new Map([[String(other._id), toParticipant(other, !!conversation.lastMessageAt)]]);
  return { created, conversation: await buildView(conversation, callerId, people) };
}

export async function listConversations(callerId: Types.ObjectId, { page, limit }: { page: number; limit: number }) {
  const rows = await Conversation.find({
    participants: callerId,
    $or: [{ openedBy: callerId }, { lastMessageAt: { $ne: null } }]
  })
    .sort({ lastMessageAt: -1, updatedAt: -1, _id: -1 })
    .skip((page - 1) * limit)
    .limit(limit + 1)
    .lean();

  const pageRows = rows.slice(0, limit);
  const people = await loadPeople(pageRows, callerId);
  const conversations = await Promise.all(pageRows.map((c) => buildView(c, callerId, people)));
  return { conversations, hasMore: rows.length > limit };
}

/** Returns null both when the conversation is missing and when the caller is not in it, so ids cannot be probed. */
export async function getConversation(callerId: Types.ObjectId, id: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  const conversation = await Conversation.findOne({ _id: id, participants: callerId }).lean();
  if (!conversation) return null;
  return buildView(conversation, callerId, await loadPeople([conversation], callerId));
}

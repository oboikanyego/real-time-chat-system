import { Types } from 'mongoose';
import { Conversation } from '../models/conversation.model';
import { User } from '../models/user.model';
import { AppError } from '../middleware/error';
import { toDirectoryEntry } from './directory.service';

export const directKeyFor = (a: Types.ObjectId | string, b: Types.ObjectId | string) => [String(a), String(b)].sort().join(':');

type ConversationRecord = {
  _id: unknown;
  type: string;
  participants: unknown[];
  lastMessage?: { text?: string | null; senderId?: unknown; sentAt?: Date | null } | null;
  lastMessageAt?: Date | null;
  createdAt: Date;
};
type Person = ReturnType<typeof toDirectoryEntry>;

/** The conversation as the caller sees it: the other participant is inlined. */
export function toConversationView(conversation: ConversationRecord, viewerId: Types.ObjectId | string, people: Map<string, Person>) {
  const otherId = conversation.participants.map(String).find((id) => id !== String(viewerId));
  return {
    id: String(conversation._id),
    type: conversation.type,
    participant: (otherId && people.get(otherId)) || { id: otherId ?? '', displayName: 'Unknown user', photoURL: null },
    lastMessage: conversation.lastMessage?.sentAt
      ? { text: conversation.lastMessage.text ?? '', senderId: String(conversation.lastMessage.senderId), sentAt: conversation.lastMessage.sentAt }
      : null,
    lastMessageAt: conversation.lastMessageAt ?? null,
    createdAt: conversation.createdAt
  };
}

async function loadPeople(conversations: ConversationRecord[], viewerId: Types.ObjectId) {
  const ids = new Set(conversations.flatMap((c) => c.participants.map(String)));
  ids.delete(String(viewerId));
  const users = await User.find({ _id: { $in: [...ids] } }, { displayName: 1, photoURL: 1 }).lean();
  return new Map(users.map((u) => [String(u._id), toDirectoryEntry(u)]));
}

/** Opens (creating if needed) the direct conversation between the caller and another user. */
export async function openDirectConversation(callerId: Types.ObjectId, otherUserId: string) {
  if (String(callerId) === otherUserId) throw new AppError(400, 'INVALID_PARTICIPANT', 'You cannot start a conversation with yourself.');

  const other = await User.findById(otherUserId, { displayName: 1, photoURL: 1 }).lean();
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
  return { created, conversation: toConversationView(conversation, callerId, new Map([[String(other._id), toDirectoryEntry(other)]])) };
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
  return { conversations: pageRows.map((c) => toConversationView(c, callerId, people)), hasMore: rows.length > limit };
}

/** Returns null both when the conversation is missing and when the caller is not in it, so ids cannot be probed. */
export async function getConversation(callerId: Types.ObjectId, id: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  const conversation = await Conversation.findOne({ _id: id, participants: callerId }).lean();
  if (!conversation) return null;
  return toConversationView(conversation, callerId, await loadPeople([conversation], callerId));
}

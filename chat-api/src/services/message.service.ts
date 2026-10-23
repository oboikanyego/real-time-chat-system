import Joi from 'joi';
import { Types } from 'mongoose';
import { Conversation } from '../models/conversation.model';
import { Message } from '../models/message.model';
import { User } from '../models/user.model';
import { AppError } from '../middleware/error';
import { emitToUser } from '../socket/realtime';
import { toConversationView } from './conversation.service';
import { toDirectoryEntry } from './directory.service';

export const sendMessageSchema = Joi.object({
  clientMessageId: Joi.string().trim().pattern(/^[\w-]+$/).min(8).max(64).required(),
  text: Joi.string().trim().min(1).max(2000).required()
});

export const socketSendSchema = sendMessageSchema.keys({
  conversationId: Joi.string().hex().length(24).required()
});

export const historyQuerySchema = Joi.object({
  before: Joi.string().hex().length(24),
  limit: Joi.number().integer().min(1).max(100).default(30)
});

type MessageRecord = {
  _id: unknown;
  conversationId: unknown;
  senderId: unknown;
  clientMessageId: string;
  text: string;
  createdAt: Date;
};

export function toMessageView(message: MessageRecord) {
  return {
    id: String(message._id),
    conversationId: String(message.conversationId),
    senderId: String(message.senderId),
    clientMessageId: message.clientMessageId,
    text: message.text,
    createdAt: message.createdAt
  };
}

/** Participant-only lookup; a missing conversation and someone else's look identical. */
async function requireParticipation(callerId: Types.ObjectId, conversationId: string) {
  const conversation = Types.ObjectId.isValid(conversationId)
    ? await Conversation.findOne({ _id: conversationId, participants: callerId }).lean()
    : null;
  if (!conversation) throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found.');
  return conversation;
}

/**
 * Stores a message and notifies both participants. Retrying with the same clientMessageId
 * returns the stored message (`duplicate: true`) without storing or broadcasting it again.
 */
export async function sendMessage(callerId: Types.ObjectId, conversationId: string, input: { clientMessageId: string; text: string }) {
  const conversation = await requireParticipation(callerId, conversationId);

  let stored;
  try {
    stored = (await Message.create({ conversationId: conversation._id, senderId: callerId, ...input })).toObject();
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    const existing = await Message.findOne({ senderId: callerId, clientMessageId: input.clientMessageId }).lean();
    if (!existing) throw error;
    if (String(existing.conversationId) !== String(conversation._id)) {
      throw new AppError(409, 'CLIENT_MESSAGE_ID_REUSED', 'This clientMessageId was already used in another conversation.');
    }
    return { message: toMessageView(existing), duplicate: true };
  }

  // The message is already stored; a failed broadcast must not turn the send into an error the client would retry.
  await publishNewMessage(conversation, stored).catch((error) => console.error('[messages] broadcast failed', error));
  return { message: toMessageView(stored), duplicate: false };
}

async function publishNewMessage(conversation: { _id: unknown; participants: Types.ObjectId[] }, message: MessageRecord) {
  const lastMessage = { text: message.text, senderId: message.senderId, sentAt: message.createdAt };
  // Only move the preview forward, so two near-simultaneous sends cannot leave an older one as "last".
  const updated =
    (await Conversation.findOneAndUpdate(
      { _id: conversation._id, $or: [{ lastMessageAt: null }, { lastMessageAt: { $lt: message.createdAt } }] },
      { $set: { lastMessage, lastMessageAt: message.createdAt } },
      { new: true }
    ).lean()) ?? (await Conversation.findById(conversation._id).lean());
  if (!updated) return;

  const users = await User.find({ _id: { $in: updated.participants } }, { displayName: 1, photoURL: 1 }).lean();
  const people = new Map(users.map((u) => [String(u._id), toDirectoryEntry(u)]));
  const payload = toMessageView(message);

  for (const participantId of updated.participants) {
    emitToUser(participantId, 'message:new', { message: payload });
    emitToUser(participantId, 'conversation:updated', { conversation: toConversationView(updated, participantId, people) });
  }
}

/** Newest-first paging, returned oldest-first so the client can render a page as-is. */
export async function listMessages(callerId: Types.ObjectId, conversationId: string, { before, limit }: { before?: string; limit: number }) {
  await requireParticipation(callerId, conversationId);
  const rows = await Message.find({ conversationId, ...(before && { _id: { $lt: before } }) })
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean();
  const page = rows.slice(0, limit).reverse();
  return { messages: page.map(toMessageView), hasMore: rows.length > limit };
}

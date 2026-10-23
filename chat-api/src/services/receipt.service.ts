import Joi from 'joi';
import { Types } from 'mongoose';
import { Conversation } from '../models/conversation.model';
import { Message } from '../models/message.model';
import { AppError } from '../middleware/error';
import { emitToUser } from '../socket/realtime';
import { buildView, cursorOf, loadPeople, requireParticipation } from './conversation.service';

export const markReadSchema = Joi.object({
  conversationId: Joi.string().hex().length(24).required(),
  messageId: Joi.string().hex().length(24).required()
});

const idOf = (value: unknown) => (value ? String(value) : null);
// ObjectIds are fixed-width hex, so string comparison matches their BSON order.
const atOrAfter = (cursor: unknown, id: string) => !!cursor && String(cursor) >= id;

/**
 * The caller has read the conversation up to `messageId`. The peer is told so they can show "Read",
 * and the caller's own tabs get the new unread count. Cursors only move forward, so repeats are free.
 */
export async function markRead(callerId: Types.ObjectId, conversationId: string, messageId: string) {
  const conversation = await requireParticipation(callerId, conversationId);
  const message = await Message.findOne({ _id: messageId, conversationId: conversation._id }, { _id: 1 }).lean();
  if (!message) throw new AppError(404, 'MESSAGE_NOT_FOUND', 'Message not found.');

  if (atOrAfter(cursorOf(conversation, callerId)?.readUpTo, messageId)) return { changed: false };

  const id = new Types.ObjectId(messageId);
  const field = (name: string) => `cursors.${callerId}.${name}`;
  const updated = await Conversation.findByIdAndUpdate(
    conversation._id,
    { $max: { [field('readUpTo')]: id, [field('deliveredUpTo')]: id } },
    { new: true }
  ).lean();
  if (!updated) throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found.');

  const mine = cursorOf(updated, callerId);
  const peer = updated.participants.find((p) => String(p) !== String(callerId));
  if (peer) {
    emitToUser(peer, 'receipt:update', {
      conversationId,
      userId: String(callerId),
      deliveredUpTo: idOf(mine?.deliveredUpTo),
      readUpTo: idOf(mine?.readUpTo)
    });
  }
  emitToUser(callerId, 'conversation:updated', { conversation: await buildView(updated, callerId, await loadPeople([updated], callerId)) });
  return { changed: true };
}

/**
 * Called when a user connects: everything sent to them while they were away is now delivered.
 * Only the newest message per conversation is checked because a cursor covers all earlier ones.
 */
export async function markPendingDelivered(userId: Types.ObjectId): Promise<void> {
  const conversations = await Conversation.find(
    { participants: userId, lastMessageAt: { $ne: null }, 'lastMessage.senderId': { $ne: userId } },
    { participants: 1, lastMessage: 1, cursors: 1 }
  ).lean();

  await Promise.all(
    conversations.map(async (c) => {
      const latest = c.lastMessage?.messageId;
      if (!latest || atOrAfter(cursorOf(c, userId)?.deliveredUpTo, String(latest))) return;
      const updated = await Conversation.findByIdAndUpdate(c._id, { $max: { [`cursors.${userId}.deliveredUpTo`]: latest } }, { new: true }).lean();
      const mine = cursorOf(updated ?? c, userId);
      emitToUser(c.lastMessage?.senderId, 'receipt:update', {
        conversationId: String(c._id),
        userId: String(userId),
        deliveredUpTo: idOf(mine?.deliveredUpTo),
        readUpTo: idOf(mine?.readUpTo)
      });
    })
  );
}

import { Conversation } from '../models/conversation.model';
import { User } from '../models/user.model';
import { emitToUser } from '../socket/realtime';

/** People who exchanged at least one message with the user; the only ones who may see their presence. */
async function contactsOf(userId: string): Promise<string[]> {
  const rows = await Conversation.find({ participants: userId, lastMessageAt: { $ne: null } }, { participants: 1 }).lean();
  return rows.flatMap((c) => c.participants.map(String)).filter((id) => id !== userId);
}

async function broadcast(userId: string, payload: { online: boolean; lastSeenAt: Date | null }) {
  for (const contact of await contactsOf(userId)) emitToUser(contact, 'presence:update', { userId, ...payload });
}

export async function announceOnline(userId: string): Promise<void> {
  await broadcast(userId, { online: true, lastSeenAt: null });
}

/** Records "last seen" when the user's last socket is gone, then tells their contacts. */
export async function announceOffline(userId: string): Promise<void> {
  const lastSeenAt = new Date();
  await User.updateOne({ _id: userId }, { $set: { lastSeenAt } });
  await broadcast(userId, { online: false, lastSeenAt });
}

/** Whether `userId` shares an established conversation (>= 1 message) with `conversationId`'s other participant. */
export async function otherParticipantIfEstablished(callerId: unknown, conversationId: string): Promise<string | null> {
  const conversation = await Conversation.findOne(
    { _id: conversationId, participants: callerId, lastMessageAt: { $ne: null } },
    { participants: 1 }
  ).lean();
  const other = conversation?.participants.find((p) => String(p) !== String(callerId));
  return other ? String(other) : null;
}

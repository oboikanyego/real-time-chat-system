import { InferSchemaType, model, Schema } from 'mongoose';

const conversationSchema = new Schema(
  {
    type: { type: String, enum: ['direct'], default: 'direct', required: true },
    participants: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      validate: { validator: (v: unknown[]) => v.length === 2, message: 'A direct conversation has exactly two participants.' }
    },
    // Sorted participant ids joined with ":"; the unique index makes "open a chat with X" idempotent.
    directKey: { type: String, required: true, unique: true },
    // Users who opened the conversation. Someone else's empty conversation stays hidden until a message arrives.
    openedBy: { type: [Schema.Types.ObjectId], default: [] },
    lastMessage: {
      type: new Schema({ text: String, senderId: Schema.Types.ObjectId, sentAt: Date }, { _id: false }),
      default: null
    },
    lastMessageAt: { type: Date, default: null }
  },
  { timestamps: true }
);

conversationSchema.index({ participants: 1, lastMessageAt: -1, updatedAt: -1 });

export type ConversationDocument = InferSchemaType<typeof conversationSchema>;
export const Conversation = model('Conversation', conversationSchema);

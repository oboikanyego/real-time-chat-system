import { InferSchemaType, model, Schema } from 'mongoose';

const userSchema = new Schema(
  {
    firebaseUid: { type: String, required: true, unique: true, index: true },
    email: { type: String, lowercase: true, trim: true },
    displayName: { type: String, required: true, trim: true, maxlength: 60 },
    photoURL: { type: String, trim: true },
    lastSeenAt: { type: Date }
  },
  { timestamps: true }
);

userSchema.index({ displayName: 1 });

export type UserDocument = InferSchemaType<typeof userSchema>;
export const User = model('User', userSchema);

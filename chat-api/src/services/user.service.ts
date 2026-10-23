import { User } from '../models/user.model';
import type { AuthenticatedUser } from '../types/auth';

type UserRecord = NonNullable<Awaited<ReturnType<typeof upsertUser>>>;

const fallbackName = (identity: AuthenticatedUser) =>
  identity.displayName?.trim() || identity.email?.split('@')[0] || 'User';

/**
 * Creates the application profile on first sign-in. On later sign-ins only the
 * email/photo are refreshed from the token; a name the user edited is kept.
 */
export async function syncUser(identity: AuthenticatedUser): Promise<UserRecord> {
  try {
    return await upsertUser(identity);
  } catch (error) {
    // Two concurrent first sign-ins can race on the unique index; the retry then finds the document.
    if ((error as { code?: number }).code === 11000) return upsertUser(identity);
    throw error;
  }
}

const upsertUser = (identity: AuthenticatedUser) =>
  User.findOneAndUpdate(
    { firebaseUid: identity.firebaseUid },
    {
      $set: { lastSeenAt: new Date(), ...(identity.email && { email: identity.email }), ...(identity.photoURL && { photoURL: identity.photoURL }) },
      $setOnInsert: { displayName: fallbackName(identity) }
    },
    { upsert: true, new: true }
  ).lean();

export async function updateDisplayName(firebaseUid: string, displayName: string) {
  return User.findOneAndUpdate({ firebaseUid }, { $set: { displayName } }, { new: true }).lean();
}

export function toProfile(user: UserRecord) {
  return {
    id: String(user._id),
    firebaseUid: user.firebaseUid,
    email: user.email ?? null,
    displayName: user.displayName,
    photoURL: user.photoURL ?? null,
    createdAt: user.createdAt
  };
}

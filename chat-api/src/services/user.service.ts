import { User } from '../models/user.model';
import type { AuthenticatedUser } from '../types/auth';

type UserRecord = NonNullable<Awaited<ReturnType<typeof upsertUser>>>;

export const toSearchTokens = (name: string) => [...new Set(name.toLowerCase().split(/\s+/).filter(Boolean))];

const fallbackName = (identity: AuthenticatedUser) =>
  identity.displayName?.trim() || identity.email?.split('@')[0] || 'User';

/**
 * Creates the application profile on first sign-in. On later sign-ins only the
 * email/photo are refreshed from the token; a name the user edited is kept.
 */
export async function syncUser(identity: AuthenticatedUser): Promise<UserRecord> {
  try {
    return await ensureSearchTokens(await upsertUser(identity));
  } catch (error) {
    // Two concurrent first sign-ins can race on the unique index; the retry then finds the document.
    if ((error as { code?: number }).code === 11000) return ensureSearchTokens(await upsertUser(identity));
    throw error;
  }
}

/** Profiles created before the directory existed have no tokens yet. */
async function ensureSearchTokens(user: UserRecord): Promise<UserRecord> {
  if (user.searchTokens?.length) return user;
  return (await User.findByIdAndUpdate(user._id, { $set: { searchTokens: toSearchTokens(user.displayName) } }, { new: true }).lean()) ?? user;
}

const upsertUser = (identity: AuthenticatedUser) =>
  User.findOneAndUpdate(
    { firebaseUid: identity.firebaseUid },
    {
      $set: { lastSeenAt: new Date(), ...(identity.email && { email: identity.email }), ...(identity.photoURL && { photoURL: identity.photoURL }) },
      $setOnInsert: { displayName: fallbackName(identity), searchTokens: toSearchTokens(fallbackName(identity)) }
    },
    { upsert: true, new: true }
  ).lean();

export async function updateDisplayName(firebaseUid: string, displayName: string) {
  return User.findOneAndUpdate({ firebaseUid }, { $set: { displayName, searchTokens: toSearchTokens(displayName) } }, { new: true }).lean();
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

/** Profile _id for an authenticated identity; creates the profile if the user has not signed in through /me yet. */
export async function resolveProfileId(identity: AuthenticatedUser) {
  const existing = await User.findOne({ firebaseUid: identity.firebaseUid }, { _id: 1 }).lean();
  return existing?._id ?? (await syncUser(identity))._id;
}

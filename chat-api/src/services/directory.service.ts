import type { FilterQuery } from 'mongoose';
import { User, type UserDocument } from '../models/user.model';

const MAX_TERMS = 5;
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export type DirectoryQuery = { q?: string; page: number; limit: number };

/**
 * `q` containing "@" is an exact email lookup. Otherwise every word of `q` must
 * prefix-match a word of the display name (e.g. "gra hop" finds "Grace Hopper").
 */
export function buildDirectoryFilter(requesterUid: string, q?: string): FilterQuery<UserDocument> {
  const filter: FilterQuery<UserDocument> = { firebaseUid: { $ne: requesterUid } };
  const text = q?.trim().toLowerCase();
  if (!text) return filter;

  if (text.includes('@')) {
    filter.email = text;
  } else {
    filter.$and = text
      .split(/\s+/)
      .slice(0, MAX_TERMS)
      .map((term) => ({ searchTokens: { $regex: `^${escapeRegex(term)}` } }));
  }
  return filter;
}

/** Public view of a user: the email is deliberately not exposed. */
export function toDirectoryEntry(user: { _id: unknown; displayName: string; photoURL?: string | null }) {
  return { id: String(user._id), displayName: user.displayName, photoURL: user.photoURL ?? null };
}

export async function searchUsers(requesterUid: string, { q, page, limit }: DirectoryQuery) {
  const rows = await User.find(buildDirectoryFilter(requesterUid, q), { displayName: 1, photoURL: 1 })
    .collation({ locale: 'en', strength: 2 })
    .sort({ displayName: 1, _id: 1 })
    .skip((page - 1) * limit)
    .limit(limit + 1)
    .lean();
  return { users: rows.slice(0, limit).map(toDirectoryEntry), page, limit, hasMore: rows.length > limit };
}

export async function findUserById(id: string) {
  const user = await User.findById(id, { displayName: 1, photoURL: 1 }).lean();
  return user ? toDirectoryEntry(user) : null;
}

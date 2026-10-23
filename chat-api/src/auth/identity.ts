import { env } from '../config/env';
import { firebaseAuth } from '../config/firebase';
import type { AuthenticatedUser } from '../types/auth';

const DEV_USER_PATTERN = /^[a-z0-9_-]{1,32}$/i;

export class UnauthorizedError extends Error {
  constructor(message = 'Invalid or expired authentication token.') {
    super(message);
  }
}

export function isDevAuth(): boolean {
  return env.authMode === 'development' && env.nodeEnv !== 'production';
}

/** Development-only identity. `devUser` lets several local users be simulated. */
export function devIdentity(devUser?: string): AuthenticatedUser {
  const name = devUser && DEV_USER_PATTERN.test(devUser) ? devUser : 'dev-user';
  return { firebaseUid: name, email: `${name}@example.com`, displayName: name };
}

/** Resolves the caller identity from a Firebase ID token (or the dev bypass). */
export async function resolveIdentity(token: string | undefined, devUser?: string): Promise<AuthenticatedUser> {
  if (isDevAuth()) return devIdentity(devUser);
  if (!token) throw new UnauthorizedError('Missing bearer token.');

  const auth = firebaseAuth();
  if (!auth) throw new UnauthorizedError();
  try {
    const decoded = await auth.verifyIdToken(token);
    return { firebaseUid: decoded.uid, email: decoded.email, displayName: decoded.name, photoURL: decoded.picture };
  } catch {
    throw new UnauthorizedError();
  }
}

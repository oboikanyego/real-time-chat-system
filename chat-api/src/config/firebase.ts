import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { env } from './env';

export function firebaseAuth() {
  if (env.authMode !== 'firebase') return null;

  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: env.firebase.projectId,
        clientEmail: env.firebase.clientEmail,
        privateKey: env.firebase.privateKey
      })
    });
  }

  return getAuth();
}

/** Called once at startup so a malformed service-account key stops the deploy instead of failing every login. */
export function assertFirebaseConfigured(): void {
  if (env.authMode === 'firebase') firebaseAuth();
}

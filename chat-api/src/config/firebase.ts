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

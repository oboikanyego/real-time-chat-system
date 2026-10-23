import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { FirebaseApp, initializeApp } from 'firebase/app';
import {
  Auth,
  GoogleAuthProvider,
  User as FirebaseUser,
  createUserWithEmailAndPassword,
  getAuth,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile
} from 'firebase/auth';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export interface Profile {
  id: string;
  firebaseUid: string;
  email: string | null;
  displayName: string;
  photoURL: string | null;
  createdAt: string;
}

const DEV_USER_KEY = 'chat.devUser';

/**
 * Owns the session. With Firebase configured it signs in through Firebase; with an
 * empty Firebase config (local Docker, AUTH_MODE=development on the API) it falls
 * back to a dev identity sent as `X-Dev-User`.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly app: FirebaseApp | null;
  private readonly auth: Auth | null;

  readonly devMode = !environment.firebase.apiKey;
  readonly ready = signal(false);
  readonly profile = signal<Profile | null>(null);
  readonly isAuthenticated = computed(() => this.profile() !== null);

  private firebaseUser: FirebaseUser | null = null;
  private devUser: string | null = null;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.app = this.devMode ? null : initializeApp(environment.firebase);
    this.auth = this.app ? getAuth(this.app) : null;
  }

  /** Resolves once the persisted session (if any) has been restored. */
  init(): Promise<void> {
    return (this.initPromise ??= this.devMode ? this.initDev() : this.initFirebase());
  }

  async register(name: string, email: string, password: string): Promise<void> {
    const { user } = await createUserWithEmailAndPassword(this.requireAuth(), email, password);
    await updateProfile(user, { displayName: name });
    await user.getIdToken(true);
    this.firebaseUser = user;
    // The listener may already have created the profile before the name was set on the Firebase user.
    await this.syncProfile();
    await this.updateDisplayName(name);
  }

  async login(email: string, password: string): Promise<void> {
    await signInWithEmailAndPassword(this.requireAuth(), email, password);
  }

  async loginWithGoogle(): Promise<void> {
    await signInWithPopup(this.requireAuth(), new GoogleAuthProvider());
  }

  async loginDev(name: string): Promise<void> {
    this.devUser = name;
    sessionStorage.setItem(DEV_USER_KEY, name);
    await this.syncProfile();
  }

  async logout(): Promise<void> {
    this.devUser = null;
    sessionStorage.removeItem(DEV_USER_KEY);
    this.profile.set(null);
    if (this.auth) await signOut(this.auth);
  }

  async updateDisplayName(displayName: string): Promise<void> {
    const res = await firstValueFrom(this.http.patch<{ data: Profile }>(`${environment.apiUrl}/api/v1/me`, { displayName }));
    this.profile.set(res.data);
  }

  /** Credentials for the API and Socket.IO handshake. */
  async credentials(): Promise<{ token?: string; devUser?: string }> {
    if (this.devMode) return this.devUser ? { devUser: this.devUser } : {};
    return { token: (await this.firebaseUser?.getIdToken()) ?? undefined };
  }

  private requireAuth(): Auth {
    if (!this.auth) throw new Error('Firebase is not configured.');
    return this.auth;
  }

  private async initDev(): Promise<void> {
    const saved = sessionStorage.getItem(DEV_USER_KEY);
    if (saved) await this.loginDev(saved).catch(() => this.logout());
    this.ready.set(true);
  }

  private initFirebase(): Promise<void> {
    return new Promise((resolve) => {
      onIdTokenChanged(this.requireAuth(), async (user) => {
        this.firebaseUser = user;
        if (user) {
          await this.syncProfile().catch(() => this.profile.set(null));
        } else {
          this.profile.set(null);
        }
        this.ready.set(true);
        resolve();
      });
    });
  }

  private async syncProfile(): Promise<void> {
    const res = await firstValueFrom(this.http.get<{ data: Profile }>(`${environment.apiUrl}/api/v1/me`));
    this.profile.set(res.data);
  }
}

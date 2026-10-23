import { Injectable, inject, signal } from '@angular/core';
import { Socket, io } from 'socket.io-client';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

export type SocketState = 'disconnected' | 'connecting' | 'connected' | 'unauthorized';

@Injectable({ providedIn: 'root' })
export class SocketService {
  private readonly auth = inject(AuthService);
  private socket: Socket | null = null;

  readonly state = signal<SocketState>('disconnected');

  connect(): void {
    if (this.socket) return;
    this.state.set('connecting');
    // The auth callback runs on every (re)connect, so a refreshed ID token is always used.
    this.socket = io(environment.socketUrl, {
      auth: (cb) => void this.auth.credentials().then(cb)
    });
    this.socket.on('system:ready', () => this.state.set('connected'));
    this.socket.on('disconnect', () => this.state.set('disconnected'));
    this.socket.on('connect_error', (err) => {
      if (err.message === 'UNAUTHORIZED') {
        // Do not hammer the server with a token it already rejected.
        this.socket?.disconnect();
        this.state.set('unauthorized');
      } else {
        this.state.set('connecting');
      }
    });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.state.set('disconnected');
  }
}

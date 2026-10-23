import { Injectable, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { Socket, io } from 'socket.io-client';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import type { Conversation } from './conversation.service';
import type { ServerMessage } from './message.service';

export type SocketState = 'disconnected' | 'connecting' | 'connected' | 'unauthorized';

export type SendAck =
  | { ok: true; message: ServerMessage; duplicate: boolean }
  | { ok: false; error: { code: string; message: string } };

export interface PresenceEvent {
  userId: string;
  online: boolean;
  lastSeenAt: string | null;
}

export interface ReceiptEvent {
  conversationId: string;
  /** Who the receipt is about: the person who received or read. */
  userId: string;
  deliveredUpTo: string | null;
  readUpTo: string | null;
}

export interface TypingEvent {
  conversationId: string;
  userId: string;
  typing: boolean;
}

const ACK_TIMEOUT_MS = 8000;

@Injectable({ providedIn: 'root' })
export class SocketService {
  private readonly auth = inject(AuthService);
  private socket: Socket | null = null;
  private hasConnected = false;

  readonly state = signal<SocketState>('disconnected');
  /** True once the first connection succeeded; used to tell "still connecting" from "lost the connection". */
  readonly everConnected = signal(false);

  /** Server pushes. */
  readonly messageNew$ = new Subject<ServerMessage>();
  readonly conversationUpdated$ = new Subject<Conversation>();
  readonly presenceUpdate$ = new Subject<PresenceEvent>();
  readonly receiptUpdate$ = new Subject<ReceiptEvent>();
  readonly typingUpdate$ = new Subject<TypingEvent>();
  /** Fires after a dropped connection comes back, so stores can refetch what they missed. */
  readonly reconnected$ = new Subject<void>();

  connect(): void {
    if (this.socket) return;
    this.state.set('connecting');
    // The auth callback runs on every (re)connect, so a refreshed ID token is always used.
    this.socket = io(environment.socketUrl, {
      auth: (cb) => void this.auth.credentials().then(cb)
    });
    this.socket.on('system:ready', () => {
      this.state.set('connected');
      this.everConnected.set(true);
      if (this.hasConnected) this.reconnected$.next();
      this.hasConnected = true;
    });
    this.socket.on('disconnect', (reason) => {
      this.state.set('disconnected');
      // socket.io does not retry after a server-initiated disconnect (e.g. a deploy), so do it here.
      if (reason === 'io server disconnect') setTimeout(() => this.socket?.connect(), 1000);
    });
    this.socket.on('connect_error', (err) => {
      if (err.message === 'UNAUTHORIZED') {
        // Do not hammer the server with a token it already rejected.
        this.socket?.disconnect();
        this.state.set('unauthorized');
      } else {
        this.state.set('connecting');
      }
    });
    this.socket.on('message:new', (e: { message: ServerMessage }) => this.messageNew$.next(e.message));
    this.socket.on('conversation:updated', (e: { conversation: Conversation }) => this.conversationUpdated$.next(e.conversation));
    this.socket.on('presence:update', (e: PresenceEvent) => this.presenceUpdate$.next(e));
    this.socket.on('receipt:update', (e: ReceiptEvent) => this.receiptUpdate$.next(e));
    this.socket.on('typing:update', (e: TypingEvent) => this.typingUpdate$.next(e));
  }

  get isConnected(): boolean {
    return this.state() === 'connected' && !!this.socket?.connected;
  }

  /** Rejects when offline or when no acknowledgement arrives in time; the caller may fall back to REST. */
  async sendMessage(payload: { conversationId: string; clientMessageId: string; text: string }): Promise<SendAck> {
    if (!this.socket || !this.isConnected) throw new Error('offline');
    return this.socket.timeout(ACK_TIMEOUT_MS).emitWithAck('message:send', payload);
  }

  /** Tells the server the user has read up to a message. Rejects if offline; callers may simply try again later. */
  async markRead(payload: { conversationId: string; messageId: string }): Promise<void> {
    if (!this.socket || !this.isConnected) throw new Error('offline');
    const ack = await this.socket.timeout(ACK_TIMEOUT_MS).emitWithAck('message:read', payload);
    if (!ack.ok) throw new Error(ack.error.code);
  }

  /** Fire-and-forget: a lost typing indicator is harmless. */
  emitTyping(conversationId: string, typing: boolean): void {
    if (this.isConnected) this.socket?.emit(typing ? 'typing:start' : 'typing:stop', { conversationId });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.hasConnected = false;
    this.everConnected.set(false);
    this.state.set('disconnected');
  }
}

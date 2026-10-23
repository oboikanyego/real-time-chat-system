import { Injectable, inject, signal } from '@angular/core';
import { SocketService } from './socket.service';

const REMOTE_EXPIRY_MS = 6000; // the other person's indicator disappears if no refresh arrives
const START_REFRESH_MS = 3000; // while typing, re-announce at most this often
const IDLE_STOP_MS = 4000; // stop announcing after this long without a keystroke

/** Tracks who is typing to us, and announces our own typing (throttled) to the other person. */
@Injectable({ providedIn: 'root' })
export class TypingService {
  private readonly socket = inject(SocketService);

  /** Conversation ids in which the other person is typing right now. */
  readonly typingIn = signal<ReadonlySet<string>>(new Set());

  private readonly expiry = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly mine = new Map<string, { lastStart: number; idle: ReturnType<typeof setTimeout> }>();

  constructor() {
    this.socket.typingUpdate$.subscribe((e) => (e.typing ? this.show(e.conversationId) : this.hide(e.conversationId)));
    // A delivered message means they stopped typing it.
    this.socket.messageNew$.subscribe((m) => this.hide(m.conversationId));
    this.socket.reconnected$.subscribe(() => [...this.typingIn()].forEach((id) => this.hide(id)));
  }

  isTyping(conversationId: string | undefined): boolean {
    return !!conversationId && this.typingIn().has(conversationId);
  }

  /** Call on every keystroke in the composer. */
  notifyTyping(conversationId: string): void {
    const now = Date.now();
    const state = this.mine.get(conversationId);
    if (!state || now - state.lastStart > START_REFRESH_MS) this.socket.emitTyping(conversationId, true);

    if (state) clearTimeout(state.idle);
    this.mine.set(conversationId, {
      lastStart: !state || now - state.lastStart > START_REFRESH_MS ? now : state.lastStart,
      idle: setTimeout(() => this.stopTyping(conversationId), IDLE_STOP_MS)
    });
  }

  /** Call when the message is sent, the draft is cleared, or the composer loses focus. */
  stopTyping(conversationId: string): void {
    const state = this.mine.get(conversationId);
    if (!state) return;
    clearTimeout(state.idle);
    this.mine.delete(conversationId);
    this.socket.emitTyping(conversationId, false);
  }

  private show(id: string): void {
    clearTimeout(this.expiry.get(id));
    this.expiry.set(id, setTimeout(() => this.hide(id), REMOTE_EXPIRY_MS));
    this.typingIn.update((s) => new Set(s).add(id));
  }

  private hide(id: string): void {
    clearTimeout(this.expiry.get(id));
    this.expiry.delete(id);
    if (!this.typingIn().has(id)) return;
    this.typingIn.update((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }
}

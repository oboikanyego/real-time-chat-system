import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { SocketService } from './socket.service';

export interface ServerMessage {
  id: string;
  conversationId: string;
  senderId: string;
  clientMessageId: string;
  text: string;
  createdAt: string;
}

export interface ChatMessage extends Omit<ServerMessage, 'id'> {
  id: string | null;
  /** `sending` and `failed` are local-only states of a message the server has not confirmed. */
  status: 'sent' | 'sending' | 'failed';
  error?: string;
}

export interface ConversationMessages {
  messages: ChatMessage[];
  hasMore: boolean;
  loading: boolean;
  loadingEarlier: boolean;
  loadError: boolean;
}

const PAGE_SIZE = 30;
const url = (conversationId: string) => `${environment.apiUrl}/api/v1/conversations/${conversationId}/messages`;

const newClientId = () =>
  globalThis.crypto?.randomUUID?.() ?? `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/** Confirmed messages in server order, then unconfirmed ones in the order they were typed. */
function arrange(messages: ChatMessage[]): ChatMessage[] {
  const sent = messages.filter((m) => m.status === 'sent').sort((a, b) => (a.id! < b.id! ? -1 : a.id! > b.id! ? 1 : 0));
  return [...sent, ...messages.filter((m) => m.status !== 'sent')];
}

function merge(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byClientId = new Map(existing.map((m) => [m.clientMessageId, m]));
  for (const m of incoming) byClientId.set(m.clientMessageId, m);
  return arrange([...byClientId.values()]);
}

const empty = (): ConversationMessages => ({ messages: [], hasMore: false, loading: false, loadingEarlier: false, loadError: false });

/** Per-conversation message state: history paging, optimistic sends and live delivery. */
@Injectable({ providedIn: 'root' })
export class MessageService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly socket = inject(SocketService);

  private readonly loaded = new Set<string>();
  readonly state = signal<Record<string, ConversationMessages>>({});

  constructor() {
    this.socket.messageNew$.subscribe((m) => this.receive(m));
    // Anything sent while the connection was down is fetched again for conversations already loaded.
    this.socket.reconnected$.subscribe(() => this.loaded.forEach((id) => void this.loadLatest(id)));
  }

  /** Loads the newest page; also used to catch up after reopening a conversation or reconnecting. */
  async loadLatest(conversationId: string): Promise<void> {
    const wasLoaded = this.loaded.has(conversationId);
    this.patch(conversationId, { loading: !wasLoaded, loadError: false });
    // Marked loaded up front so pushes that arrive while the page is in flight are kept, not dropped.
    this.loaded.add(conversationId);
    try {
      const page = await this.fetchPage(conversationId);
      const incoming = page.data.map(toChat);
      this.update(conversationId, (s) => {
        const overlaps = incoming.some((m) => s.messages.some((e) => e.id === m.id));
        // If we were away long enough that the new page does not touch what we have, keep only the new page.
        const reset = wasLoaded && incoming.length > 0 && !overlaps && s.messages.some((m) => m.status === 'sent');
        const base = reset ? s.messages.filter((m) => m.status !== 'sent') : s.messages;
        return {
          ...s,
          messages: merge(base, incoming),
          hasMore: wasLoaded && !reset ? s.hasMore : page.meta.hasMore,
          loading: false
        };
      });
    } catch {
      if (!wasLoaded) this.loaded.delete(conversationId);
      this.patch(conversationId, { loading: false, loadError: true });
    }
  }

  async loadEarlier(conversationId: string): Promise<void> {
    const s = this.state()[conversationId];
    const oldest = s?.messages.find((m) => m.status === 'sent');
    if (!s || !oldest || s.loadingEarlier || !s.hasMore) return;
    this.patch(conversationId, { loadingEarlier: true });
    try {
      const page = await this.fetchPage(conversationId, oldest.id!);
      this.update(conversationId, (cur) => ({
        ...cur,
        messages: merge(cur.messages, page.data.map(toChat)),
        hasMore: page.meta.hasMore,
        loadingEarlier: false
      }));
    } catch {
      this.patch(conversationId, { loadingEarlier: false });
    }
  }

  /** Shows the message immediately, then confirms it with the server. */
  send(conversationId: string, rawText: string): void {
    const text = rawText.trim();
    const me = this.auth.profile();
    if (!text || !me) return;
    const message: ChatMessage = {
      id: null,
      conversationId,
      senderId: me.id,
      clientMessageId: newClientId(),
      text,
      createdAt: new Date().toISOString(),
      status: 'sending'
    };
    this.update(conversationId, (s) => ({ ...s, messages: [...s.messages, message] }));
    void this.deliver(message);
  }

  retry(conversationId: string, clientMessageId: string): void {
    const message = this.state()[conversationId]?.messages.find((m) => m.clientMessageId === clientMessageId);
    if (!message || message.status !== 'failed') return;
    this.replace(message, { ...message, status: 'sending', error: undefined });
    void this.deliver(message);
  }

  /** A message pushed by the server (ours echoed back from another tab, or the other person's). */
  receive(message: ServerMessage): void {
    if (!this.loaded.has(message.conversationId)) return; // fetched when the conversation is opened
    this.update(message.conversationId, (s) => ({ ...s, messages: merge(s.messages, [toChat(message)]) }));
  }

  reset(): void {
    this.loaded.clear();
    this.state.set({});
  }

  private async deliver(message: ChatMessage): Promise<void> {
    const payload = { conversationId: message.conversationId, clientMessageId: message.clientMessageId, text: message.text };
    try {
      let ack;
      try {
        ack = await this.socket.sendMessage(payload);
      } catch {
        // Offline or no ack in time. The server de-duplicates on clientMessageId, so REST is safe even if the socket send landed.
        const res = await firstValueFrom(this.http.post<{ data: ServerMessage }>(url(message.conversationId), payload));
        ack = { ok: true as const, message: res.data, duplicate: false };
      }
      if (ack.ok) this.replace(message, toChat(ack.message));
      else this.replace(message, { ...message, status: 'failed', error: ack.error.message });
    } catch (error) {
      const apiMessage = (error as { error?: { error?: { message?: string } } }).error?.error?.message;
      this.replace(message, { ...message, status: 'failed', error: apiMessage ?? "Couldn't send. Check your connection." });
    }
  }

  /** Swaps a local message for its confirmed or failed version, matching by clientMessageId. */
  private replace(original: ChatMessage, next: ChatMessage): void {
    this.update(original.conversationId, (s) => ({
      ...s,
      messages: arrange(s.messages.map((m) => (m.clientMessageId === original.clientMessageId ? next : m)))
    }));
  }

  private fetchPage(conversationId: string, before?: string) {
    let params = new HttpParams().set('limit', PAGE_SIZE);
    if (before) params = params.set('before', before);
    return firstValueFrom(this.http.get<{ data: ServerMessage[]; meta: { hasMore: boolean } }>(url(conversationId), { params }));
  }

  private patch(conversationId: string, changes: Partial<ConversationMessages>): void {
    this.update(conversationId, (s) => ({ ...s, ...changes }));
  }

  private update(conversationId: string, fn: (s: ConversationMessages) => ConversationMessages): void {
    this.state.update((all) => ({ ...all, [conversationId]: fn(all[conversationId] ?? empty()) }));
  }
}

const toChat = (m: ServerMessage): ChatMessage => ({ ...m, status: 'sent' });

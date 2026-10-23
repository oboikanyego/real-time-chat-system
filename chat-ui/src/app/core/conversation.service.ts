import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { DirectoryUser } from './directory.service';
import { SocketService } from './socket.service';
import { laterId } from './time';

export interface Presence {
  online: boolean;
  lastSeenAt: string | null;
}

export interface Participant extends DirectoryUser {
  /** Null until the two have exchanged a message; presence is not shared before that. */
  presence: Presence | null;
}

export interface Conversation {
  id: string;
  type: 'direct';
  participant: Participant;
  lastMessage: { id: string | null; text: string; senderId: string; sentAt: string } | null;
  lastMessageAt: string | null;
  /** Messages from the other person after your read cursor (capped at 100). */
  unreadCount: number;
  /** How far the other person has received / read, as message ids. */
  peerReceipts: { deliveredUpTo: string | null; readUpTo: string | null };
  createdAt: string;
}

interface Page {
  data: Conversation[];
  meta: { hasMore: boolean };
}

const PAGE_SIZE = 30;
const base = `${environment.apiUrl}/api/v1/conversations`;

/** Same order as the API: most recent message first; conversations without messages last. */
function precedes(a: Conversation, b: Conversation): boolean {
  if (a.lastMessageAt && b.lastMessageAt) return a.lastMessageAt > b.lastMessageAt;
  return !!a.lastMessageAt && !b.lastMessageAt;
}

/** Puts one conversation in its place; among equals the newest arrival goes first. */
function place(list: Conversation[], conversation: Conversation): Conversation[] {
  const rest = list.filter((c) => c.id !== conversation.id);
  const at = rest.findIndex((c) => !precedes(c, conversation));
  return at === -1 ? [...rest, conversation] : [...rest.slice(0, at), conversation, ...rest.slice(at)];
}

/** Client-side store for the caller's conversation list. */
@Injectable({ providedIn: 'root' })
export class ConversationService {
  private readonly http = inject(HttpClient);
  private readonly socket = inject(SocketService);
  private page = 1;

  readonly conversations = signal<Conversation[]>([]);
  readonly loading = signal(false);
  readonly loadingMore = signal(false);
  readonly error = signal(false);
  readonly hasMore = signal(false);

  constructor() {
    // A new message makes the conversation appear (for the recipient) or move up and update its preview.
    this.socket.conversationUpdated$.subscribe((c) => this.conversations.update((list) => place(list, c)));
    this.socket.presenceUpdate$.subscribe((p) =>
      this.change((c) =>
        c.participant.id === p.userId
          ? { ...c, participant: { ...c.participant, presence: { online: p.online, lastSeenAt: p.lastSeenAt ?? c.participant.presence?.lastSeenAt ?? null } } }
          : c
      )
    );
    // Receipts only move forward, so a late or repeated event cannot undo a newer one.
    this.socket.receiptUpdate$.subscribe((r) =>
      this.change((c) =>
        c.id === r.conversationId && c.participant.id === r.userId
          ? {
              ...c,
              peerReceipts: {
                deliveredUpTo: laterId(c.peerReceipts.deliveredUpTo, r.deliveredUpTo),
                readUpTo: laterId(c.peerReceipts.readUpTo, r.readUpTo)
              }
            }
          : c
      )
    );
    // Missed updates while disconnected are recovered by reloading the first page.
    this.socket.reconnected$.subscribe(() => void this.refresh());
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(false);
    try {
      const res = await this.fetchPage(1);
      this.page = 1;
      this.conversations.set(res.data);
      this.hasMore.set(res.meta.hasMore);
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  async loadMore(): Promise<void> {
    if (this.loadingMore() || !this.hasMore()) return;
    this.loadingMore.set(true);
    try {
      const res = await this.fetchPage(this.page + 1);
      this.page += 1;
      this.upsertMany(res.data);
      this.hasMore.set(res.meta.hasMore);
    } catch {
      this.error.set(true);
    } finally {
      this.loadingMore.set(false);
    }
  }

  /** Opens (or creates) the direct conversation with a user and puts it at the top of the list. */
  async open(userId: string): Promise<Conversation> {
    const res = await firstValueFrom(this.http.post<{ data: Conversation }>(base, { userId }));
    // Keep what the list already knows (e.g. the last message) if the conversation is present.
    this.conversations.update((list) => (list.some((c) => c.id === res.data.id) ? list : place(list, res.data)));
    return res.data;
  }

  /** Looks in the list first, then asks the API (the conversation may not be on the first page). */
  async get(id: string): Promise<Conversation | null> {
    const known = this.conversations().find((c) => c.id === id);
    if (known) return known;
    try {
      const fetched = (await firstValueFrom(this.http.get<{ data: Conversation }>(`${base}/${id}`))).data;
      // Conversations with messages belong in the list (and then stay live); an empty one is not listed by the API either.
      if (fetched.lastMessageAt) this.conversations.update((list) => (list.some((c) => c.id === id) ? list : place(list, fetched)));
      return fetched;
    } catch {
      return null;
    }
  }

  /** Clears the badge straight away; the server confirms with its own conversation:updated. */
  markReadLocally(id: string): void {
    this.change((c) => (c.id === id && c.unreadCount > 0 ? { ...c, unreadCount: 0 } : c));
  }

  private change(fn: (c: Conversation) => Conversation): void {
    this.conversations.update((list) => list.map(fn));
  }

  /** Reloads the first page without flashing the loading state, keeping anything already on screen. */
  private async refresh(): Promise<void> {
    try {
      const res = await this.fetchPage(1);
      this.conversations.update((list) => res.data.reduce(place, list));
    } catch {
      /* keep the current list; the next event or reload will correct it */
    }
  }

  reset(): void {
    this.conversations.set([]);
    this.hasMore.set(false);
    this.error.set(false);
    this.page = 1;
  }

  private fetchPage(page: number): Promise<Page> {
    const params = new HttpParams().set('page', page).set('limit', PAGE_SIZE);
    return firstValueFrom(this.http.get<Page>(base, { params }));
  }

  private upsertMany(incoming: Conversation[]): void {
    this.conversations.update((list) => {
      const ids = new Set(list.map((c) => c.id));
      return [...list, ...incoming.filter((c) => !ids.has(c.id))];
    });
  }
}

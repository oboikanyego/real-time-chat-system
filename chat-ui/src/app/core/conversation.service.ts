import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { DirectoryUser } from './directory.service';

export interface Conversation {
  id: string;
  type: 'direct';
  participant: DirectoryUser;
  lastMessage: { text: string; senderId: string; sentAt: string } | null;
  lastMessageAt: string | null;
  createdAt: string;
}

interface Page {
  data: Conversation[];
  meta: { hasMore: boolean };
}

const PAGE_SIZE = 30;
const base = `${environment.apiUrl}/api/v1/conversations`;

/** Client-side store for the caller's conversation list. */
@Injectable({ providedIn: 'root' })
export class ConversationService {
  private readonly http = inject(HttpClient);
  private page = 1;

  readonly conversations = signal<Conversation[]>([]);
  readonly loading = signal(false);
  readonly loadingMore = signal(false);
  readonly error = signal(false);
  readonly hasMore = signal(false);

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
    this.conversations.update((list) => [res.data, ...list.filter((c) => c.id !== res.data.id)]);
    return res.data;
  }

  /** Looks in the list first, then asks the API (the conversation may not be on the first page). */
  async get(id: string): Promise<Conversation | null> {
    const known = this.conversations().find((c) => c.id === id);
    if (known) return known;
    try {
      return (await firstValueFrom(this.http.get<{ data: Conversation }>(`${base}/${id}`))).data;
    } catch {
      return null;
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

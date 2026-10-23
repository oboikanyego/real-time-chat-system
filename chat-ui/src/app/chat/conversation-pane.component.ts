import { DatePipe } from '@angular/common';
import { Component, DestroyRef, ElementRef, HostListener, Injector, afterNextRender, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { Conversation, ConversationService } from '../core/conversation.service';
import { ChatMessage, MessageService } from '../core/message.service';
import { dayKey, dayLabel, idAtOrBefore, lastSeenLabel } from '../core/time';
import { TypingService } from '../core/typing.service';
import { AvatarComponent } from '../shared/avatar.component';

const NEAR_BOTTOM_PX = 120;
/** Messages from one person this close together read as one group. */
const GROUP_GAP_MS = 5 * 60_000;

type Row =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'msg'; key: string; message: ChatMessage; first: boolean; last: boolean };

/** Main area of the chat page. `id` comes from the route; without one it shows an empty state. */
@Component({
  selector: 'app-conversation-pane',
  standalone: true,
  imports: [RouterLink, FormsModule, DatePipe, AvatarComponent],
  templateUrl: './conversation-pane.component.html',
  styleUrl: './conversation-pane.component.css'
})
export class ConversationPaneComponent {
  private readonly conversations = inject(ConversationService);
  private readonly messageStore = inject(MessageService);
  private readonly injector = inject(Injector);
  private readonly typingService = inject(TypingService);
  private readonly me = inject(AuthService).profile;

  readonly id = input<string>();

  protected readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  protected readonly state = signal<'idle' | 'loading' | 'ready' | 'missing'>('idle');
  /** Only used for a conversation that is not in the list (e.g. a deep link); the list copy is the live one. */
  private readonly fetched = signal<Conversation | null>(null);
  protected readonly conversation = computed(
    () => this.conversations.conversations().find((c) => c.id === this.id()) ?? this.fetched()
  );
  protected draft = '';

  /** Whether the user can actually see the page; read receipts are only sent then. */
  private readonly active = signal(document.visibilityState === 'visible' && document.hasFocus());
  private readonly now = signal(new Date());

  protected readonly subtitle = computed(() => {
    const c = this.conversation();
    if (!c) return { text: '', kind: 'none' as const };
    if (this.typingService.isTyping(c.id)) return { text: 'typing…', kind: 'typing' as const };
    const p = c.participant.presence;
    if (!p) return { text: '', kind: 'none' as const };
    return p.online ? { text: 'Online', kind: 'online' as const } : { text: lastSeenLabel(p.lastSeenAt, this.now()), kind: 'offline' as const };
  });

  protected readonly thread = computed(() => {
    const id = this.id();
    return id ? this.messageStore.state()[id] : undefined;
  });
  protected readonly messages = computed(() => this.thread()?.messages ?? []);

  /** Messages with day separators, and each message marked as first/last of its run from the same sender. */
  protected readonly rows = computed<Row[]>(() => {
    const list = this.messages();
    const now = this.now();
    const rows: Row[] = [];
    list.forEach((m, i) => {
      const prev = list[i - 1];
      const next = list[i + 1];
      const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
      if (newDay) rows.push({ kind: 'day', key: `day-${dayKey(m.createdAt)}`, label: dayLabel(m.createdAt, now) });
      const joins = (a: ChatMessage | undefined, b: ChatMessage | undefined) =>
        !!a && !!b && a.senderId === b.senderId && dayKey(a.createdAt) === dayKey(b.createdAt) &&
        Math.abs(new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) < GROUP_GAP_MS;
      rows.push({ kind: 'msg', key: m.clientMessageId, message: m, first: !joins(prev, m), last: !joins(m, next) });
    });
    return rows;
  });

  protected readonly skeletons = [0, 1, 2];
  /** How many messages from the other person arrived while the reader was scrolled up. */
  protected readonly newBelow = signal(0);
  private readonly composer = viewChild<ElementRef<HTMLTextAreaElement>>('composer');

  @HostListener('document:visibilitychange')
  @HostListener('window:focus')
  @HostListener('window:blur')
  protected updateActive(): void {
    this.active.set(document.visibilityState === 'visible' && document.hasFocus());
  }

  constructor() {
    const ticker = setInterval(() => this.now.set(new Date()), 30_000);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(ticker);
      this.stopTyping();
    });

    // Report messages as read while the conversation is on screen and the page is in view.
    effect(() => {
      const id = this.id();
      if (id && this.state() === 'ready' && this.active()) this.messageStore.markRead(id);
    });

    // Runs only when the route's conversation id changes. Everything else is untracked: the store calls below
    // read signals (the conversation list), and tracking them would reset this view and the draft on every incoming message.
    effect(() => {
      const id = this.id();
      untracked(() => this.openConversation(id));
    });

    // Follow new messages when the reader is already at the bottom, or when they sent it themselves.
    let lastKey = '';
    let lastMessageId = '';
    effect(() => {
      const list = this.messages();
      const last = list[list.length - 1];
      const key = `${this.id()}|${last?.clientMessageId}|${last?.status}`;
      if (key === lastKey || !last) return;
      const firstRender = !lastKey.startsWith(`${this.id()}|`);
      const isNew = last.clientMessageId !== lastMessageId;
      lastKey = key;
      lastMessageId = last.clientMessageId;
      if (firstRender || this.nearBottom() || this.isMine(last)) this.scrollToBottom();
      else if (isNew) this.newBelow.update((n) => n + 1);
    });
  }

  private openConversation(id: string | undefined): void {
    this.draft = '';
    if (!id) {
      this.state.set('idle');
      this.fetched.set(null);
      return;
    }
    this.state.set('loading');
    void this.conversations.get(id).then((found) => {
      // Ignore a response for a conversation the user has already navigated away from.
      if (this.id() !== id) return;
      this.fetched.set(found);
      this.state.set(found ? 'ready' : 'missing');
      if (found) {
        this.newBelow.set(0);
        // Keyboard users can type straight away; on touch screens focusing would pop the keyboard open.
        if (matchMedia('(pointer: fine)').matches) afterNextRender(() => this.composer()?.nativeElement.focus(), { injector: this.injector });
        void this.messageStore.loadLatest(id).then(() => this.scrollToBottom());
      }
    });
  }

  protected isMine(m: ChatMessage): boolean {
    return m.senderId === this.me()?.id;
  }

  /** Delivery state of a message I sent, from the other person's receipt cursors. */
  protected receipt(m: ChatMessage): 'sent' | 'delivered' | 'read' {
    const r = this.conversation()?.peerReceipts;
    if (idAtOrBefore(m.id, r?.readUpTo ?? null)) return 'read';
    if (idAtOrBefore(m.id, r?.deliveredUpTo ?? null)) return 'delivered';
    return 'sent';
  }

  protected submit(event?: Event): void {
    event?.preventDefault();
    const id = this.id();
    if (!id || !this.draft.trim()) return;
    this.messageStore.send(id, this.draft);
    this.draft = '';
    this.stopTyping();
  }

  protected onInput(): void {
    const id = this.id();
    if (!id) return;
    if (this.draft.trim()) this.typingService.notifyTyping(id);
    else this.typingService.stopTyping(id);
  }

  protected stopTyping(): void {
    const id = this.id();
    if (id) this.typingService.stopTyping(id);
  }

  protected onEnter(event: Event): void {
    const e = event as KeyboardEvent;
    // Enter sends, Shift+Enter inserts a newline; IME composition must not send.
    if (e.shiftKey || e.isComposing) return;
    this.submit(e);
  }

  protected retry(m: ChatMessage): void {
    this.messageStore.retry(m.conversationId, m.clientMessageId);
  }

  protected reload(): void {
    const id = this.id();
    if (id) void this.messageStore.loadLatest(id);
  }

  protected async loadEarlier(): Promise<void> {
    const id = this.id();
    const el = this.scroller()?.nativeElement;
    if (!id || !el) return;
    const before = el.scrollHeight;
    await this.messageStore.loadEarlier(id);
    // Keep the message the reader was looking at in place after older ones are inserted above it.
    afterNextRender(() => (el.scrollTop += el.scrollHeight - before), { injector: this.injector });
  }

  private nearBottom(): boolean {
    const el = this.scroller()?.nativeElement;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }

  protected onScroll(): void {
    if (this.newBelow() > 0 && this.nearBottom()) this.newBelow.set(0);
  }

  protected jumpToLatest(): void {
    this.newBelow.set(0);
    this.scrollToBottom();
  }

  private scrollToBottom(): void {
    this.newBelow.set(0);
    afterNextRender(
      () => {
        const el = this.scroller()?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
      },
      { injector: this.injector }
    );
  }
}

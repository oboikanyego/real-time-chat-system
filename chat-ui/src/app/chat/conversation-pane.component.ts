import { DatePipe } from '@angular/common';
import { Component, DestroyRef, ElementRef, HostListener, Injector, afterNextRender, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { Conversation, ConversationService } from '../core/conversation.service';
import { ChatMessage, MessageService } from '../core/message.service';
import { idAtOrBefore, lastSeenLabel } from '../core/time';
import { TypingService } from '../core/typing.service';
import { AvatarComponent } from '../shared/avatar.component';

const NEAR_BOTTOM_PX = 120;

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

    effect(() => {
      const id = this.id();
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
          void this.messageStore.loadLatest(id).then(() => this.scrollToBottom());
        }
      });
    });

    // Follow new messages when the reader is already at the bottom, or when they sent it themselves.
    let lastKey = '';
    effect(() => {
      const list = this.messages();
      const last = list[list.length - 1];
      const key = `${this.id()}|${last?.clientMessageId}|${last?.status}`;
      if (key === lastKey || !last) return;
      const firstRender = !lastKey.startsWith(`${this.id()}|`);
      lastKey = key;
      const el = this.scroller()?.nativeElement;
      const nearBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
      if (firstRender || nearBottom || last.senderId === this.me()?.id) this.scrollToBottom();
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

  private scrollToBottom(): void {
    afterNextRender(
      () => {
        const el = this.scroller()?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
      },
      { injector: this.injector }
    );
  }
}

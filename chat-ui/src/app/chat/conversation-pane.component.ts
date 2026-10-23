import { DatePipe } from '@angular/common';
import { Component, ElementRef, Injector, afterNextRender, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { Conversation, ConversationService } from '../core/conversation.service';
import { ChatMessage, MessageService } from '../core/message.service';
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
  private readonly me = inject(AuthService).profile;

  readonly id = input<string>();

  protected readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  protected readonly state = signal<'idle' | 'loading' | 'ready' | 'missing'>('idle');
  protected readonly conversation = signal<Conversation | null>(null);
  protected draft = '';

  protected readonly thread = computed(() => {
    const id = this.id();
    return id ? this.messageStore.state()[id] : undefined;
  });
  protected readonly messages = computed(() => this.thread()?.messages ?? []);

  constructor() {
    effect(() => {
      const id = this.id();
      this.draft = '';
      if (!id) {
        this.state.set('idle');
        this.conversation.set(null);
        return;
      }
      this.state.set('loading');
      void this.conversations.get(id).then((found) => {
        // Ignore a response for a conversation the user has already navigated away from.
        if (this.id() !== id) return;
        this.conversation.set(found);
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

  protected submit(event?: Event): void {
    event?.preventDefault();
    const id = this.id();
    if (!id || !this.draft.trim()) return;
    this.messageStore.send(id, this.draft);
    this.draft = '';
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

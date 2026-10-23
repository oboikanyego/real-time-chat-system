import { Component, ElementRef, OnDestroy, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { Router, RouterOutlet } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { ConversationService } from '../core/conversation.service';
import { DirectoryUser } from '../core/directory.service';
import { MessageService } from '../core/message.service';
import { SocketService } from '../core/socket.service';
import { ThemeService } from '../core/theme.service';
import { UserDirectoryComponent } from '../directory/user-directory.component';
import { AvatarComponent } from '../shared/avatar.component';
import { ConversationListComponent } from './conversation-list.component';
import { ProfileDialogComponent } from './profile-dialog.component';

type Tab = 'chats' | 'people';
const TABS: Tab[] = ['chats', 'people'];

/** Authenticated shell: conversation list / people search on the left, the open conversation on the right. */
@Component({
  selector: 'app-chat-home',
  standalone: true,
  imports: [RouterOutlet, ConversationListComponent, UserDirectoryComponent, ProfileDialogComponent, AvatarComponent],
  templateUrl: './chat-home.component.html',
  styleUrl: './chat-home.component.css'
})
export class ChatHomeComponent implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthService);
  protected readonly socket = inject(SocketService);
  protected readonly theme = inject(ThemeService);
  private readonly conversations = inject(ConversationService);
  private readonly messages = inject(MessageService);
  private readonly router = inject(Router);
  private readonly title = inject(Title);

  private readonly profileDialog = viewChild.required(ProfileDialogComponent);
  private readonly mainEl = viewChild<ElementRef<HTMLElement>>('main');

  private readonly totalUnread = computed(() => this.conversations.conversations().reduce((sum, c) => sum + c.unreadCount, 0));

  protected readonly tab = signal<Tab>('chats');
  protected readonly openError = signal('');
  /** On narrow screens only one of the sidebar and the conversation is shown. */
  protected readonly conversationOpen = toSignal(
    this.router.events.pipe(map(() => this.router.url.startsWith('/chat/'))),
    { initialValue: this.router.url.startsWith('/chat/') }
  );

  /** Nothing to say while the first connection is being made; afterwards any gap is worth showing. */
  protected readonly banner = computed(() => {
    const state = this.socket.state();
    if (state === 'unauthorized') return { kind: 'error' as const, text: 'Your session has expired. Sign in again to keep chatting.' };
    if (state === 'disconnected' && this.socket.everConnected()) return { kind: 'warn' as const, text: "You're offline. Messages will send when you're back." };
    if (state === 'connecting' && this.socket.everConnected()) return { kind: 'warn' as const, text: 'Reconnecting…' };
    return null;
  });

  protected readonly themeLabel = computed(() => {
    const pref = this.theme.preference();
    const next = pref === 'system' ? 'light' : pref === 'light' ? 'dark' : 'system';
    return `Theme: ${pref}. Switch to ${next}.`;
  });

  constructor() {
    // "(3) Real-Time Chat" in the browser tab while there is something unread.
    effect(() => this.title.setTitle(this.totalUnread() > 0 ? `(${this.totalUnread()}) Real-Time Chat` : 'Real-Time Chat'));
  }

  ngOnInit(): void {
    this.socket.connect();
    void this.conversations.load();
  }

  ngOnDestroy(): void {
    this.title.setTitle('Real-Time Chat');
    this.socket.disconnect();
  }

  protected openProfile(): void {
    this.profileDialog().open();
  }

  protected skipToConversation(event: Event): void {
    event.preventDefault();
    this.mainEl()?.nativeElement.focus();
  }

  /** Arrow keys, Home and End move between tabs, as in the ARIA tabs pattern. */
  protected onTabKey(event: KeyboardEvent): void {
    const index = TABS.indexOf(this.tab());
    const next =
      event.key === 'ArrowRight' ? (index + 1) % TABS.length
      : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? TABS.length - 1
      : -1;
    if (next < 0) return;
    event.preventDefault();
    this.tab.set(TABS[next]!);
    queueMicrotask(() => document.getElementById(`tab-${TABS[next]}`)?.focus());
  }

  protected async startChat(user: DirectoryUser): Promise<void> {
    this.openError.set('');
    try {
      const conversation = await this.conversations.open(user.id);
      this.tab.set('chats');
      await this.router.navigate(['/chat', conversation.id]);
    } catch {
      this.openError.set(`Couldn't start a conversation with ${user.displayName}. Please try again.`);
    }
  }

  protected async logout(): Promise<void> {
    this.socket.disconnect();
    this.conversations.reset();
    this.messages.reset();
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}

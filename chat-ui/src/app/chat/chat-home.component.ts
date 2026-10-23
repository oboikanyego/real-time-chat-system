import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterOutlet } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { ConversationService } from '../core/conversation.service';
import { DirectoryUser } from '../core/directory.service';
import { MessageService } from '../core/message.service';
import { SocketService } from '../core/socket.service';
import { UserDirectoryComponent } from '../directory/user-directory.component';
import { ConversationListComponent } from './conversation-list.component';

/** Authenticated shell: conversation list / people search on the left, the open conversation on the right. */
@Component({
  selector: 'app-chat-home',
  standalone: true,
  imports: [RouterOutlet, ConversationListComponent, UserDirectoryComponent],
  templateUrl: './chat-home.component.html',
  styleUrl: './chat-home.component.css'
})
export class ChatHomeComponent implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthService);
  protected readonly socket = inject(SocketService);
  private readonly conversations = inject(ConversationService);
  private readonly messages = inject(MessageService);
  private readonly router = inject(Router);

  protected readonly tab = signal<'chats' | 'people'>('chats');
  protected readonly openError = signal('');
  /** On narrow screens only one of the sidebar and the conversation is shown. */
  protected readonly conversationOpen = toSignal(
    this.router.events.pipe(map(() => this.router.url.startsWith('/chat/'))),
    { initialValue: this.router.url.startsWith('/chat/') }
  );

  ngOnInit(): void {
    this.socket.connect();
    void this.conversations.load();
  }

  ngOnDestroy(): void {
    this.socket.disconnect();
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

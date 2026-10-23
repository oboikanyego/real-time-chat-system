import { Component, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Conversation, ConversationService } from '../core/conversation.service';
import { AvatarComponent } from '../shared/avatar.component';

/** Main area of the chat page. `id` comes from the route; without one it shows an empty state. */
@Component({
  selector: 'app-conversation-pane',
  standalone: true,
  imports: [RouterLink, AvatarComponent],
  templateUrl: './conversation-pane.component.html',
  styleUrl: './conversation-pane.component.css'
})
export class ConversationPaneComponent {
  private readonly store = inject(ConversationService);

  readonly id = input<string>();

  protected readonly state = signal<'idle' | 'loading' | 'ready' | 'missing'>('idle');
  protected readonly conversation = signal<Conversation | null>(null);

  constructor() {
    effect(() => {
      const id = this.id();
      if (!id) {
        this.state.set('idle');
        this.conversation.set(null);
        return;
      }
      this.state.set('loading');
      void this.store.get(id).then((found) => {
        // Ignore a response for a conversation the user has already navigated away from.
        if (this.id() !== id) return;
        this.conversation.set(found);
        this.state.set(found ? 'ready' : 'missing');
      });
    });
  }
}

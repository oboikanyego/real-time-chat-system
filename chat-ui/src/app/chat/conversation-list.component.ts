import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ConversationService } from '../core/conversation.service';
import { AvatarComponent } from '../shared/avatar.component';

@Component({
  selector: 'app-conversation-list',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, AvatarComponent],
  templateUrl: './conversation-list.component.html',
  styleUrl: './conversation-list.component.css'
})
export class ConversationListComponent {
  protected readonly store = inject(ConversationService);
}

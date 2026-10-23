import { Component, inject, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ConversationService } from '../core/conversation.service';
import { listTime } from '../core/time';
import { TypingService } from '../core/typing.service';
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
  protected readonly typing = inject(TypingService);

  /** Asked for from the empty state, so the shell can switch to the People tab. */
  readonly findPeople = output<void>();

  protected readonly listTime = listTime;
  protected readonly skeletonRows = [0, 1, 2, 3];

  protected badge(count: number): string {
    return count > 99 ? '99+' : String(count);
  }
}

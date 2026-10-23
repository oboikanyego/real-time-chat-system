import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { DirectoryUser } from '../core/directory.service';
import { SocketService } from '../core/socket.service';
import { UserDirectoryComponent } from '../directory/user-directory.component';

/** Authenticated landing page; conversations and messaging arrive in later phases. */
@Component({
  selector: 'app-chat-home',
  standalone: true,
  imports: [UserDirectoryComponent],
  templateUrl: './chat-home.component.html',
  styleUrl: './chat-home.component.css'
})
export class ChatHomeComponent implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthService);
  protected readonly socket = inject(SocketService);
  private readonly router = inject(Router);

  protected readonly selected = signal<DirectoryUser | null>(null);

  ngOnInit(): void {
    this.socket.connect();
  }

  ngOnDestroy(): void {
    this.socket.disconnect();
  }

  protected async logout(): Promise<void> {
    this.socket.disconnect();
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}

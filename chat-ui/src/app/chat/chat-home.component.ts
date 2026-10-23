import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { SocketService } from '../core/socket.service';

/** Authenticated landing page; conversations and messaging arrive in later phases. */
@Component({
  selector: 'app-chat-home',
  standalone: true,
  templateUrl: './chat-home.component.html',
  styleUrl: './chat-home.component.css'
})
export class ChatHomeComponent implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthService);
  protected readonly socket = inject(SocketService);
  private readonly router = inject(Router);

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

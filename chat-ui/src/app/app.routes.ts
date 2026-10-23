import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth.guard';

const pane = () => import('./chat/conversation-pane.component').then((m) => m.ConversationPaneComponent);

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    data: { mode: 'login' },
    loadComponent: () => import('./auth/auth-page.component').then((m) => m.AuthPageComponent)
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    data: { mode: 'register' },
    loadComponent: () => import('./auth/auth-page.component').then((m) => m.AuthPageComponent)
  },
  {
    path: 'chat',
    canActivate: [authGuard],
    loadComponent: () => import('./chat/chat-home.component').then((m) => m.ChatHomeComponent),
    children: [
      { path: '', loadComponent: pane },
      { path: ':id', loadComponent: pane }
    ]
  },
  { path: '', pathMatch: 'full', redirectTo: 'chat' },
  { path: '**', redirectTo: 'chat' }
];

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  await auth.init();
  return auth.isAuthenticated() || inject(Router).createUrlTree(['/login']);
};

/** Keeps signed-in users away from the login/register pages. */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  await auth.init();
  return !auth.isAuthenticated() || inject(Router).createUrlTree(['/chat']);
};

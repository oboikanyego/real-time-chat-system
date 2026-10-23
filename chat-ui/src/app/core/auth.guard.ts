import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

// inject() only works synchronously, so dependencies are resolved before the first await.
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.init();
  return auth.isAuthenticated() || router.createUrlTree(['/login']);
};

/** Keeps signed-in users away from the login/register pages. */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.init();
  return !auth.isAuthenticated() || router.createUrlTree(['/chat']);
};

import { Component, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';

const FIREBASE_MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/user-not-found': 'Incorrect email or password.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/email-already-in-use': 'An account with this email already exists.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/too-many-requests': 'Too many attempts. Try again later.',
  'auth/popup-closed-by-user': 'Sign-in was cancelled.',
  'auth/network-request-failed': 'Network error. Check your connection.'
};

@Component({
  selector: 'app-auth-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './auth-page.component.html',
  styleUrl: './auth-page.component.css'
})
export class AuthPageComponent {
  /** Route data: which form to show. */
  readonly mode = input<'login' | 'register'>('login');

  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);

  protected readonly isRegister = computed(() => this.mode() === 'register');
  protected readonly busy = signal(false);
  protected readonly showPassword = signal(false);
  protected readonly error = signal('');

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.maxLength(60)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]]
  });

  protected readonly devForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.pattern(/^[a-z0-9_-]{1,32}$/i)]]
  });

  protected submit(): void {
    const { name, email, password } = this.form.getRawValue();
    if (this.isRegister() && !name.trim()) {
      this.error.set('Enter your name.');
      return;
    }
    if (this.form.controls.email.invalid || this.form.controls.password.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    void this.run(() => (this.isRegister() ? this.auth.register(name.trim(), email, password) : this.auth.login(email, password)));
  }

  protected google(): void {
    void this.run(() => this.auth.loginWithGoogle());
  }

  protected devSubmit(): void {
    if (this.devForm.invalid) {
      this.devForm.markAllAsTouched();
      return;
    }
    void this.run(() => this.auth.loginDev(this.devForm.getRawValue().name));
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await action();
      // Login flows resolve once Firebase has signed in; wait for the profile sync.
      await this.waitForProfile();
      await this.router.navigateByUrl('/chat');
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      this.error.set(FIREBASE_MESSAGES[code] ?? 'Could not sign in. Please try again.');
    } finally {
      this.busy.set(false);
    }
  }

  private async waitForProfile(): Promise<void> {
    for (let i = 0; i < 50 && !this.auth.isAuthenticated(); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!this.auth.isAuthenticated()) throw new Error('profile');
  }
}

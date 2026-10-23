import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../core/auth.service';
import { AvatarComponent } from '../shared/avatar.component';

/** Edit-profile dialog built on the native <dialog>: focus trapping and Esc come for free. */
@Component({
  selector: 'app-profile-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, AvatarComponent],
  templateUrl: './profile-dialog.component.html',
  styleUrl: './profile-dialog.component.css'
})
export class ProfileDialogComponent {
  protected readonly auth = inject(AuthService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly form = inject(FormBuilder).nonNullable.group({
    displayName: ['', [Validators.required, Validators.maxLength(60), Validators.pattern(/\S/)]]
  });
  protected readonly saving = signal(false);
  protected readonly error = signal('');

  open(): void {
    this.form.reset({ displayName: this.auth.profile()?.displayName ?? '' });
    this.error.set('');
    this.dialog().nativeElement.showModal();
  }

  protected close(): void {
    this.dialog().nativeElement.close();
  }

  protected async save(): Promise<void> {
    const name = this.form.controls.displayName.value.trim();
    if (this.form.invalid || !name) {
      this.form.markAllAsTouched();
      return;
    }
    if (name === this.auth.profile()?.displayName) return this.close();

    this.saving.set(true);
    this.error.set('');
    try {
      await this.auth.updateDisplayName(name);
      this.close();
    } catch {
      this.error.set("Couldn't save your name. Please try again.");
    } finally {
      this.saving.set(false);
    }
  }
}

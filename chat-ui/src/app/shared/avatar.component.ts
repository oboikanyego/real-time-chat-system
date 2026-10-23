import { Component, computed, input } from '@angular/core';

/** Profile photo, or the person's initials when there is none. */
@Component({
  selector: 'app-avatar',
  standalone: true,
  template: `
    @if (photoURL()) {
      <img [src]="photoURL()" alt="" referrerpolicy="no-referrer" />
    } @else {
      <span aria-hidden="true">{{ initials() }}</span>
    }
  `,
  styles: `
    :host { display: inline-grid; flex: none; width: var(--avatar-size, 36px); height: var(--avatar-size, 36px); border-radius: 50%; overflow: hidden; place-items: center; background: #111827; color: #fff; font-size: .8rem; font-weight: 700; }
    img { width: 100%; height: 100%; object-fit: cover; }
  `
})
export class AvatarComponent {
  readonly name = input.required<string>();
  readonly photoURL = input<string | null>(null);

  protected readonly initials = computed(() =>
    this.name().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')
  );
}

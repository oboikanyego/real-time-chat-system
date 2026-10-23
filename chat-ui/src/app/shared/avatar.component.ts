import { Component, computed, input } from '@angular/core';

/** Profile photo, or the person's initials when there is none. A green dot marks someone who is online. */
@Component({
  selector: 'app-avatar',
  standalone: true,
  template: `
    <span class="face">
      @if (photoURL()) {
        <img [src]="photoURL()" alt="" referrerpolicy="no-referrer" />
      } @else {
        <span aria-hidden="true">{{ initials() }}</span>
      }
    </span>
    @if (online()) {
      <i class="dot" title="Online"></i>
    }
  `,
  styles: `
    :host { position: relative; display: inline-block; flex: none; width: var(--avatar-size, 36px); height: var(--avatar-size, 36px); }
    .face { display: grid; place-items: center; width: 100%; height: 100%; border-radius: 50%; overflow: hidden; background: #111827; color: #fff; font-size: .8rem; font-weight: 700; }
    img { width: 100%; height: 100%; object-fit: cover; }
    .dot { position: absolute; right: -1px; bottom: -1px; width: 11px; height: 11px; border-radius: 50%; background: #22c55e; border: 2px solid #fff; }
  `
})
export class AvatarComponent {
  readonly name = input.required<string>();
  readonly photoURL = input<string | null>(null);
  readonly online = input(false);

  protected readonly initials = computed(() =>
    this.name().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')
  );
}

import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, signal } from '@angular/core';

export type ThemePreference = 'system' | 'light' | 'dark';
const KEY = 'chat.theme';
const ORDER: ThemePreference[] = ['system', 'light', 'dark'];

/** Light/dark theme with a "system" default. The saved choice is applied before first paint by index.html. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly media = this.doc.defaultView?.matchMedia('(prefers-color-scheme: dark)');
  private readonly systemDark = signal(!!this.media?.matches);

  readonly preference = signal<ThemePreference>(this.read());

  constructor() {
    this.media?.addEventListener('change', (e) => this.systemDark.set(e.matches));
    effect(() => {
      const pref = this.preference();
      const dark = pref === 'dark' || (pref === 'system' && this.systemDark());
      this.doc.documentElement.dataset['theme'] = dark ? 'dark' : 'light';
      this.doc.documentElement.style.colorScheme = dark ? 'dark' : 'light';
      this.write(pref);
    });
  }

  /** system -> light -> dark -> system */
  cycle(): void {
    this.preference.set(ORDER[(ORDER.indexOf(this.preference()) + 1) % ORDER.length]!);
  }

  private read(): ThemePreference {
    try {
      const saved = localStorage.getItem(KEY);
      return ORDER.includes(saved as ThemePreference) ? (saved as ThemePreference) : 'system';
    } catch {
      return 'system';
    }
  }

  private write(pref: ThemePreference): void {
    try {
      localStorage.setItem(KEY, pref);
    } catch {
      /* storage unavailable (private mode): the choice just lasts for this session */
    }
  }
}

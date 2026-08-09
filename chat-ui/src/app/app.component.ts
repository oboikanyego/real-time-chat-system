import { Component, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  readonly apiState = signal<'idle' | 'checking' | 'online' | 'offline'>('idle');
  readonly apiLabel = computed(() => ({
    idle: 'Not checked',
    checking: 'Checking...',
    online: 'API online',
    offline: 'API unavailable'
  })[this.apiState()]);

  constructor(private readonly http: HttpClient) {}

  checkApi(): void {
    this.apiState.set('checking');
    this.http.get(`${environment.apiUrl}/health`).subscribe({
      next: () => this.apiState.set('online'),
      error: () => this.apiState.set('offline')
    });
  }
}

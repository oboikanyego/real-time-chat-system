import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';

export interface DirectoryUser {
  id: string;
  displayName: string;
  photoURL: string | null;
}

export interface DirectoryPage {
  users: DirectoryUser[];
  hasMore: boolean;
}

@Injectable({ providedIn: 'root' })
export class DirectoryService {
  private readonly http = inject(HttpClient);

  search(q: string, page = 1, limit = 20): Observable<DirectoryPage> {
    const params = new HttpParams().set('q', q).set('page', page).set('limit', limit);
    return this.http
      .get<{ data: DirectoryUser[]; meta: { hasMore: boolean } }>(`${environment.apiUrl}/api/v1/users`, { params })
      .pipe(map((res) => ({ users: res.data, hasMore: res.meta.hasMore })));
  }
}

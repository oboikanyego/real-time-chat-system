import { Component, DestroyRef, OnInit, inject, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { EMPTY, Subject, Subscription, catchError, debounceTime, distinctUntilChanged, startWith, switchMap, tap } from 'rxjs';
import { DirectoryService, DirectoryUser } from '../core/directory.service';
import { AvatarComponent } from '../shared/avatar.component';

/** Searchable list of other users. Emits the user the caller picks. */
@Component({
  selector: 'app-user-directory',
  standalone: true,
  imports: [ReactiveFormsModule, AvatarComponent],
  templateUrl: './user-directory.component.html',
  styleUrl: './user-directory.component.css'
})
export class UserDirectoryComponent implements OnInit {
  private readonly directory = inject(DirectoryService);
  private readonly destroyRef = inject(DestroyRef);

  readonly userSelected = output<DirectoryUser>();

  protected readonly query = new FormControl('', { nonNullable: true });
  protected readonly users = signal<DirectoryUser[]>([]);
  protected readonly loading = signal(false);
  protected readonly loadingMore = signal(false);
  protected readonly error = signal(false);
  protected readonly loadMoreFailed = signal(false);
  protected readonly hasMore = signal(false);
  protected readonly selectedId = signal<string | null>(null);

  private page = 1;
  private moreSub?: Subscription;
  private readonly retry$ = new Subject<void>();

  ngOnInit(): void {
    // A new term (or retry) cancels any in-flight request, so stale responses never overwrite newer ones.
    this.query.valueChanges
      .pipe(
        debounceTime(250),
        distinctUntilChanged((a, b) => a.trim() === b.trim()),
        startWith(this.query.value)
      )
      .pipe(
        switchMap((q) => this.retry$.pipe(startWith(undefined), switchMap(() => this.load(q.trim())))),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  protected retry(): void {
    this.retry$.next();
  }

  protected select(user: DirectoryUser): void {
    this.selectedId.set(user.id);
    this.userSelected.emit(user);
  }

  protected loadMore(): void {
    if (this.loadingMore()) return;
    this.loadingMore.set(true);
    this.loadMoreFailed.set(false);
    this.moreSub = this.directory
      .search(this.query.value.trim(), this.page + 1)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.page += 1;
          this.users.update((current) => [...current, ...res.users]);
          this.hasMore.set(res.hasMore);
          this.loadingMore.set(false);
        },
        error: () => {
          this.loadingMore.set(false);
          this.loadMoreFailed.set(true);
        }
      });
  }

  private load(q: string) {
    // A new search invalidates any "load more" still in flight for the previous term.
    this.moreSub?.unsubscribe();
    this.loadingMore.set(false);
    this.loadMoreFailed.set(false);
    this.loading.set(true);
    this.error.set(false);
    this.page = 1;
    return this.directory.search(q).pipe(
      tap((res) => {
        this.users.set(res.users);
        this.hasMore.set(res.hasMore);
        this.loading.set(false);
      }),
      catchError(() => {
        this.users.set([]);
        this.hasMore.set(false);
        this.loading.set(false);
        this.error.set(true);
        return EMPTY;
      })
    );
  }
}

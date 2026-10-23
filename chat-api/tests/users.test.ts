import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/firebase', () => ({
  firebaseAuth: () => ({ verifyIdToken: async () => ({ uid: 'me', email: 'me@x.com', name: 'Me' }) })
}));

const searchUsers = vi.fn();
const findUserById = vi.fn();
vi.mock('../src/services/directory.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/directory.service')>()),
  searchUsers,
  findUserById
}));

const { createApp } = await import('../src/app');
const { buildDirectoryFilter, toDirectoryEntry } = await import('../src/services/directory.service');
const app = createApp();
const get = (url: string) => request(app).get(url).set('Authorization', 'Bearer t');

beforeEach(() => {
  vi.clearAllMocks();
  searchUsers.mockResolvedValue({ users: [{ id: '1', displayName: 'Grace', photoURL: null }], page: 1, limit: 20, hasMore: false });
});

describe('GET /api/v1/users', () => {
  it('requires auth', async () => {
    expect((await request(app).get('/api/v1/users')).status).toBe(401);
  });

  it('applies defaults and returns data with pagination meta', async () => {
    const res = await get('/api/v1/users');
    expect(res.status).toBe(200);
    expect(searchUsers).toHaveBeenCalledWith('me', { q: '', page: 1, limit: 20 });
    expect(res.body).toEqual({
      success: true,
      data: [{ id: '1', displayName: 'Grace', photoURL: null }],
      meta: { page: 1, limit: 20, hasMore: false }
    });
  });

  it('passes the trimmed query and paging through', async () => {
    await get('/api/v1/users?q=%20gra%20&page=2&limit=5');
    expect(searchUsers).toHaveBeenCalledWith('me', { q: 'gra', page: 2, limit: 5 });
  });

  it.each(['limit=0', 'limit=51', 'page=0', 'page=abc', `q=${'x'.repeat(101)}`])('rejects %s', async (qs) => {
    const res = await get(`/api/v1/users?${qs}`);
    expect(res.status).toBe(400);
    expect(searchUsers).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/users/:id', () => {
  it('returns 404 for a malformed id without hitting the database', async () => {
    const res = await get('/api/v1/users/not-an-id');
    expect(res.status).toBe(404);
    expect(findUserById).not.toHaveBeenCalled();
  });

  it('returns 404 when missing and the user when found', async () => {
    const id = '507f1f77bcf86cd799439011';
    findUserById.mockResolvedValueOnce(null);
    expect((await get(`/api/v1/users/${id}`)).status).toBe(404);
    findUserById.mockResolvedValueOnce({ id, displayName: 'Ada', photoURL: null });
    const res = await get(`/api/v1/users/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.displayName).toBe('Ada');
  });
});

describe('buildDirectoryFilter', () => {
  it('only excludes the requester when there is no query', () => {
    expect(buildDirectoryFilter('me', '  ')).toEqual({ firebaseUid: { $ne: 'me' } });
  });

  it('requires every word to prefix-match a token', () => {
    expect(buildDirectoryFilter('me', 'Gra hop').$and).toEqual([
      { searchTokens: { $regex: '^gra' } },
      { searchTokens: { $regex: '^hop' } }
    ]);
  });

  it('escapes regex metacharacters', () => {
    expect(buildDirectoryFilter('me', 'a.*(').$and).toEqual([{ searchTokens: { $regex: '^a\\.\\*\\(' } }]);
  });

  it('treats a query with @ as an exact lowercase email lookup', () => {
    const filter = buildDirectoryFilter('me', 'Ada@Example.com');
    expect(filter.email).toBe('ada@example.com');
    expect(filter.$and).toBeUndefined();
  });

  it('limits the number of terms', () => {
    expect(buildDirectoryFilter('me', 'a b c d e f g').$and).toHaveLength(5);
  });
});

describe('toDirectoryEntry', () => {
  it('never exposes email or uid', () => {
    const entry = toDirectoryEntry({ _id: 7, displayName: 'A', photoURL: undefined, email: 'a@b.c', firebaseUid: 'u' } as never);
    expect(entry).toEqual({ id: '7', displayName: 'A', photoURL: null });
  });
});

describe('operational endpoints', () => {
  it('/health is a liveness probe that never touches the database', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('/ready reports 503 until the database is connected', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable', database: 'down' });
  });

  it('does not log or expose the framework', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

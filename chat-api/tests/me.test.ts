import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyIdToken = vi.fn();
vi.mock('../src/config/firebase', () => ({ firebaseAuth: () => ({ verifyIdToken }) }));

const syncUser = vi.fn();
const updateDisplayName = vi.fn();
vi.mock('../src/services/user.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/user.service')>()),
  syncUser,
  updateDisplayName
}));

const { createApp } = await import('../src/app');
const app = createApp();

const dbUser = { _id: 'abc', firebaseUid: 'u1', email: 'a@b.com', displayName: 'Ada', createdAt: new Date('2026-01-01') };

beforeEach(() => {
  vi.clearAllMocks();
  verifyIdToken.mockResolvedValue({ uid: 'u1', email: 'a@b.com', name: 'Ada' });
  syncUser.mockResolvedValue(dbUser);
  updateDisplayName.mockResolvedValue({ ...dbUser, displayName: 'Grace' });
});

describe('GET /api/v1/me', () => {
  it('rejects a missing token', async () => {
    const res = await request(app).get('/api/v1/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(syncUser).not.toHaveBeenCalled();
  });

  it('rejects an invalid token', async () => {
    verifyIdToken.mockRejectedValue(new Error('bad'));
    const res = await request(app).get('/api/v1/me').set('Authorization', 'Bearer nope');
    expect(res.status).toBe(401);
  });

  it('syncs and returns the profile for a valid token', async () => {
    const res = await request(app).get('/api/v1/me').set('Authorization', 'Bearer good');
    expect(res.status).toBe(200);
    expect(syncUser).toHaveBeenCalledWith({ firebaseUid: 'u1', email: 'a@b.com', displayName: 'Ada', photoURL: undefined });
    expect(res.body.data).toMatchObject({ id: 'abc', displayName: 'Ada', email: 'a@b.com' });
  });
});

describe('PATCH /api/v1/me', () => {
  const patch = (body: unknown) => request(app).patch('/api/v1/me').set('Authorization', 'Bearer good').send(body as object);

  it('updates the display name', async () => {
    const res = await patch({ displayName: '  Grace ' });
    expect(res.status).toBe(200);
    expect(updateDisplayName).toHaveBeenCalledWith('u1', 'Grace');
    expect(res.body.data.displayName).toBe('Grace');
  });

  it.each([{}, { displayName: '' }, { displayName: 'x'.repeat(61) }])('rejects invalid body %j', async (body) => {
    const res = await patch(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('requires auth', async () => {
    const res = await request(app).patch('/api/v1/me').send({ displayName: 'x' });
    expect(res.status).toBe(401);
  });
});

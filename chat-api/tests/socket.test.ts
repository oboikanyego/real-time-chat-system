import http from 'http';
import type { AddressInfo } from 'net';
import { io as connect } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const verifyIdToken = vi.fn(async (token: string) => {
  if (token !== 'good') throw new Error('bad');
  return { uid: 'u1', email: 'a@b.com' };
});
vi.mock('../src/config/firebase', () => ({ firebaseAuth: () => ({ verifyIdToken }) }));

const { createSocketServer } = await import('../src/socket/socket');

let server: http.Server;
let io: ReturnType<typeof createSocketServer>;
let url: string;

beforeAll(async () => {
  server = http.createServer();
  io = createSocketServer(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  url = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  io.close();
  server.close();
});

describe('socket handshake auth', () => {
  it('accepts a valid token and announces readiness', async () => {
    const client = connect(url, { auth: { token: 'good' }, transports: ['websocket'] });
    const ready = await new Promise<{ firebaseUid: string }>((resolve) => client.on('system:ready', resolve));
    expect(ready.firebaseUid).toBe('u1');
    client.close();
  });

  it.each([{}, { token: 'bad' }])('rejects handshake %j', async (auth) => {
    const client = connect(url, { auth, transports: ['websocket'], reconnection: false });
    const err = await new Promise<Error>((resolve) => client.on('connect_error', resolve));
    expect(err.message).toBe('UNAUTHORIZED');
    client.close();
  });
});

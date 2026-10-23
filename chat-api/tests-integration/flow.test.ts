import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * End-to-end checks against a running API (AUTH_MODE=development, PRESENCE_GRACE_MS small) and a real MongoDB.
 * The unit tests mock the database; this is where queries, indexes and atomic updates are actually exercised.
 */
const API = process.env['API_URL'] ?? 'http://localhost:3000';
const run = Math.random().toString(36).replace(/[^a-z]/g, '').slice(0, 6).padEnd(6, 'x');
const names = { alice: `alice${run}`, bob: `bob${run}`, carol: `carol${run}` };

type Json = any;
async function call(user: string, method: string, path: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'x-dev-user': user, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const sockets: Socket[] = [];
async function open(user: string): Promise<Socket> {
  const socket = connect(API, { auth: { devUser: user }, transports: ['websocket'], reconnection: false });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('system:ready', () => resolve());
    socket.once('connect_error', reject);
  });
  return socket;
}
const next = <T = Json>(socket: Socket, event: string, ms = 5000) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
    socket.once(event, (payload: T) => (clearTimeout(timer), resolve(payload)));
  });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const send = (socket: Socket, conversationId: string, text: string, clientMessageId = `cid-${Math.random().toString(36).slice(2)}-${Date.now()}`) =>
  socket.emitWithAck('message:send', { conversationId, clientMessageId, text });

let alice: Json, bob: Json, carol: Json;
let conversationId: string;

afterAll(() => sockets.forEach((s) => s.close()));

describe('profiles and the directory', () => {
  beforeAll(async () => {
    [alice, bob, carol] = (await Promise.all(Object.values(names).map((n) => call(n, 'GET', '/api/v1/me')))).map((r) => r.body.data);
  });

  it('creates a profile on first sign-in and is idempotent', async () => {
    expect(alice.displayName).toBe(names.alice);
    const again = await call(names.alice, 'GET', '/api/v1/me');
    expect(again.body.data.id).toBe(alice.id);
  });

  it('survives concurrent first sign-ins without duplicates', async () => {
    const name = `racer${run}`;
    const results = await Promise.all(Array.from({ length: 8 }, () => call(name, 'GET', '/api/v1/me')));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
  });

  it('renames, and search follows the new name by word prefix', async () => {
    const renamed = await call(names.bob, 'PATCH', '/api/v1/me', { displayName: `Grace${run} Hopper${run}` });
    expect(renamed.body.data.displayName).toBe(`Grace${run} Hopper${run}`);
    bob = renamed.body.data;

    const byFirst = await call(names.alice, 'GET', `/api/v1/users?q=${`grace${run}`.slice(0, 8)}`);
    expect(byFirst.body.data.map((u: Json) => u.id)).toContain(bob.id);
    const byBoth = await call(names.alice, 'GET', `/api/v1/users?q=gra hop`.replace('gra hop', `grace${run} hopper`));
    expect(byBoth.body.data.map((u: Json) => u.id)).toContain(bob.id);
    const byOld = await call(names.alice, 'GET', `/api/v1/users?q=${names.bob}`);
    expect(byOld.body.data.map((u: Json) => u.id)).not.toContain(bob.id);
  });

  it('never returns the caller, emails or uids; email lookup is exact', async () => {
    const res = await call(names.alice, 'GET', `/api/v1/users?q=${encodeURIComponent(`${names.carol}@example.com`)}`);
    expect(res.body.data.map((u: Json) => u.id)).toEqual([carol.id]);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['displayName', 'id', 'photoURL']);
    const self = await call(names.alice, 'GET', `/api/v1/users?q=${names.alice}`);
    expect(self.body.data.map((u: Json) => u.id)).not.toContain(alice.id);
  });

  it('treats regex characters literally and paginates', async () => {
    expect((await call(names.alice, 'GET', '/api/v1/users?q=.*')).body.data).toEqual([]);
    const page1 = await call(names.alice, 'GET', '/api/v1/users?limit=1&page=1');
    expect(page1.body.data).toHaveLength(1);
    expect(page1.body.meta.hasMore).toBe(true);
    const page2 = await call(names.alice, 'GET', '/api/v1/users?limit=1&page=2');
    expect(page2.body.data[0].id).not.toBe(page1.body.data[0].id);
  });
});

describe('conversations', () => {
  it('opens idempotently, and concurrent opens yield one conversation', async () => {
    const first = await call(names.alice, 'POST', '/api/v1/conversations', { userId: bob.id });
    expect(first.status).toBe(201);
    conversationId = first.body.data.id;
    const results = await Promise.all(Array.from({ length: 6 }, () => call(names.bob, 'POST', '/api/v1/conversations', { userId: alice.id })));
    expect(results.every((r) => r.body.data.id === conversationId)).toBe(true);
    expect((await call(names.alice, 'POST', '/api/v1/conversations', { userId: bob.id })).status).toBe(200);
  });

  it('refuses self-chat and unknown users', async () => {
    expect((await call(names.alice, 'POST', '/api/v1/conversations', { userId: alice.id })).status).toBe(400);
    expect((await call(names.alice, 'POST', '/api/v1/conversations', { userId: '0'.repeat(24) })).status).toBe(404);
  });

  it('hides an empty conversation from someone who has not opened it', async () => {
    const withCarol = await call(names.alice, 'POST', '/api/v1/conversations', { userId: carol.id });
    const carolList = await call(names.carol, 'GET', '/api/v1/conversations');
    expect(carolList.body.data.map((c: Json) => c.id)).not.toContain(withCarol.body.data.id);
    const aliceList = await call(names.alice, 'GET', '/api/v1/conversations');
    expect(aliceList.body.data.map((c: Json) => c.id)).toContain(withCarol.body.data.id);
  });

  it('is invisible to non-participants', async () => {
    expect((await call(names.carol, 'GET', `/api/v1/conversations/${conversationId}`)).status).toBe(404);
    expect((await call(names.carol, 'GET', `/api/v1/conversations/${conversationId}/messages`)).status).toBe(404);
    expect((await call(names.carol, 'POST', `/api/v1/conversations/${conversationId}/messages`, { clientMessageId: 'carol-intruder-1', text: 'hi' })).status).toBe(404);
  });
});

describe('messaging, receipts, presence and typing over sockets', () => {
  let a: Socket, b: Socket;
  let firstMessage: Json;

  it('delivers a message live, with unread count, delivery receipt and presence only after a first message', async () => {
    a = await open(names.alice);
    b = await open(names.bob);
    const presenceBefore: Json[] = [];
    a.on('presence:update', (p) => presenceBefore.push(p));

    const bobMessage = next(b, 'message:new');
    const bobView = next(b, 'conversation:updated');
    const aliceView = next(a, 'conversation:updated');
    const ack = await send(a, conversationId, '  hello bob  ', 'cid-first-message-1');
    expect(ack).toMatchObject({ ok: true, duplicate: false, message: { text: 'hello bob' } });
    firstMessage = ack.message;

    expect((await bobMessage).message.id).toBe(firstMessage.id);
    const forBob = (await bobView).conversation;
    expect(forBob.unreadCount).toBe(1);
    expect(forBob.participant.presence).toMatchObject({ online: true });
    const forAlice = (await aliceView).conversation;
    expect(forAlice.unreadCount).toBe(0);
    expect(forAlice.peerReceipts.deliveredUpTo).toBe(firstMessage.id); // bob had a live socket
    expect(forAlice.peerReceipts.readUpTo).toBeNull();
    expect(presenceBefore).toEqual([]);
  });

  it('is idempotent on clientMessageId, over sockets and REST', async () => {
    const dup = await send(a, conversationId, 'hello bob', 'cid-first-message-1');
    expect(dup).toMatchObject({ ok: true, duplicate: true, message: { id: firstMessage.id } });
    const rest = await call(names.alice, 'POST', `/api/v1/conversations/${conversationId}/messages`, { clientMessageId: 'cid-first-message-1', text: 'hello bob' });
    expect(rest.status).toBe(200);
    expect(rest.body.data.id).toBe(firstMessage.id);
    const history = await call(names.alice, 'GET', `/api/v1/conversations/${conversationId}/messages`);
    expect(history.body.data).toHaveLength(1);
  });

  it('rejects the same clientMessageId in another conversation, and bad payloads', async () => {
    const other = (await call(names.alice, 'POST', '/api/v1/conversations', { userId: carol.id })).body.data.id;
    const reuse = await send(a, other, 'x', 'cid-first-message-1');
    expect(reuse).toMatchObject({ ok: false, error: { code: 'CLIENT_MESSAGE_ID_REUSED' } });
    expect(await send(a, conversationId, '   ')).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(await send(a, conversationId, 'x'.repeat(2001))).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    const stranger = await open(names.carol);
    expect(await send(stranger, conversationId, 'let me in')).toMatchObject({ ok: false, error: { code: 'CONVERSATION_NOT_FOUND' } });
  });

  it('marks read: peer gets the receipt, reader gets unread 0, REST agrees; repeats are no-ops', async () => {
    const receipt = next(a, 'receipt:update');
    const mine = next(b, 'conversation:updated');
    expect(await b.emitWithAck('message:read', { conversationId, messageId: firstMessage.id })).toEqual({ ok: true, changed: true });
    expect(await receipt).toMatchObject({ userId: bob.id, readUpTo: firstMessage.id, deliveredUpTo: firstMessage.id });
    expect((await mine).conversation.unreadCount).toBe(0);

    const list = await call(names.bob, 'GET', '/api/v1/conversations');
    expect(list.body.data.find((c: Json) => c.id === conversationId).unreadCount).toBe(0);
    const aliceSide = await call(names.alice, 'GET', `/api/v1/conversations/${conversationId}`);
    expect(aliceSide.body.data.peerReceipts).toEqual({ deliveredUpTo: firstMessage.id, readUpTo: firstMessage.id });
    expect(await b.emitWithAck('message:read', { conversationId, messageId: firstMessage.id })).toEqual({ ok: true, changed: false });
  });

  it('read cursors never move backwards and unread counts follow the cursor', async () => {
    const m2 = (await send(a, conversationId, 'second')).message;
    const m3 = (await send(a, conversationId, 'third')).message;
    await wait(150);
    let view = (await call(names.bob, 'GET', `/api/v1/conversations/${conversationId}`)).body.data;
    expect(view.unreadCount).toBe(2);
    await b.emitWithAck('message:read', { conversationId, messageId: m2.id });
    view = (await call(names.bob, 'GET', `/api/v1/conversations/${conversationId}`)).body.data;
    expect(view.unreadCount).toBe(1);
    expect(await b.emitWithAck('message:read', { conversationId, messageId: firstMessage.id })).toEqual({ ok: true, changed: false });
    await b.emitWithAck('message:read', { conversationId, messageId: m3.id });
    view = (await call(names.alice, 'GET', `/api/v1/conversations/${conversationId}`)).body.data;
    expect(view.peerReceipts.readUpTo).toBe(m3.id);
  });

  it('pages history newest-first by cursor without gaps or overlap', async () => {
    // Bulk sends go over REST: one socket is limited to 20 sends per 10 s (covered separately below).
    for (let i = 0; i < 35; i++) {
      await call(names.alice, 'POST', `/api/v1/conversations/${conversationId}/messages`, { clientMessageId: `bulk-${run}-${i}-xxxx`, text: `msg ${i}` });
    }
    const page1 = (await call(names.bob, 'GET', `/api/v1/conversations/${conversationId}/messages?limit=30`)).body;
    expect(page1.data).toHaveLength(30);
    expect(page1.meta.hasMore).toBe(true);
    expect(page1.data.at(-1).text).toBe('msg 34');
    const ids = page1.data.map((m: Json) => m.id);
    expect([...ids].sort()).toEqual(ids); // oldest first within the page
    const page2 = (await call(names.bob, 'GET', `/api/v1/conversations/${conversationId}/messages?limit=30&before=${ids[0]}`)).body;
    expect(page2.data).toHaveLength(8); // 3 earlier + 35 - 30
    expect(page2.meta.hasMore).toBe(false);
    expect(new Set([...ids, ...page2.data.map((m: Json) => m.id)]).size).toBe(38);
    const list = await call(names.bob, 'GET', '/api/v1/conversations');
    const mine = list.body.data.find((c: Json) => c.id === conversationId);
    expect(mine.lastMessage.text).toBe('msg 34');
    expect(mine.unreadCount).toBe(35);
  });

  it('relays typing to the other participant only', async () => {
    const seenByAlice: Json[] = [];
    a.on('typing:update', (t) => seenByAlice.push(t));
    const typing = next(b, 'typing:update');
    a.emit('typing:start', { conversationId });
    expect(await typing).toEqual({ conversationId, userId: alice.id, typing: true });
    await wait(100);
    expect(seenByAlice).toEqual([]);
  });

  it('keeps a user online across a quick reload, then reports offline with last seen', async () => {
    const events: Json[] = [];
    a.on('presence:update', (p) => events.push(p));
    b.close();
    await wait(100);
    b = await open(names.bob); // back within the grace period
    await wait(700);
    expect(events).toEqual([]);

    b.close();
    const offline = await next(a, 'presence:update', 4000);
    expect(offline).toMatchObject({ userId: bob.id, online: false });
    expect(new Date(offline.lastSeenAt).getTime()).toBeGreaterThan(Date.now() - 5000);
    const view = (await call(names.alice, 'GET', `/api/v1/conversations/${conversationId}`)).body.data;
    expect(view.participant.presence).toMatchObject({ online: false, lastSeenAt: offline.lastSeenAt });
  });

  it('rate-limits a flooding socket (20 sends per 10 s) without affecting other sockets', async () => {
    const flooder = await open(names.carol);
    const withCarol = (await call(names.carol, 'POST', '/api/v1/conversations', { userId: alice.id })).body.data.id;
    const acks = await Promise.all(Array.from({ length: 25 }, (_, i) => send(flooder, withCarol, `flood ${i}`, `flood-${run}-${i}-xxxx`)));
    expect(acks.filter((x) => x.ok)).toHaveLength(20);
    expect(acks.filter((x) => !x.ok && x.error.code === 'RATE_LIMITED')).toHaveLength(5);
    expect((await send(a, conversationId, 'unaffected')).ok).toBe(true);
  });

  it('leaves messages undelivered while offline, then delivers on reconnect', async () => {
    const ack = await send(a, conversationId, 'while you are away');
    expect(ack.ok).toBe(true);
    const m = ack.message;
    await wait(100);
    let view = (await call(names.alice, 'GET', `/api/v1/conversations/${conversationId}`)).body.data;
    expect(BigInt(`0x${view.peerReceipts.deliveredUpTo}`) < BigInt(`0x${m.id}`)).toBe(true);

    const online = next(a, 'presence:update');
    const receipt = next(a, 'receipt:update');
    b = await open(names.bob);
    expect((await receipt).deliveredUpTo).toBe(m.id);
    expect(await online).toMatchObject({ userId: bob.id, online: true });
    view = (await call(names.alice, 'GET', `/api/v1/conversations/${conversationId}`)).body.data;
    expect(view.peerReceipts.deliveredUpTo).toBe(m.id);
  });
});

import http from 'http';
import type { AddressInfo } from 'net';
import { Types } from 'mongoose';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const alice = new Types.ObjectId();
const bob = new Types.ObjectId();
const carol = new Types.ObjectId(); // not in the conversation
const convId = new Types.ObjectId();
const profiles: Record<string, Types.ObjectId> = { alice, bob, carol };

vi.mock('../src/config/firebase', () => ({
  firebaseAuth: () => ({
    verifyIdToken: async (token: string) => {
      if (!(token in profiles)) throw new Error('bad token');
      return { uid: token, email: `${token}@x.com` };
    }
  })
}));
vi.mock('../src/services/user.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/user.service')>()),
  resolveProfileId: async (identity: { firebaseUid: string }) => profiles[identity.firebaseUid]
}));

// Minimal in-memory stand-ins for the models used by the send/receipt/presence paths.
const lean = <T>(value: T) => ({ lean: async () => value });
type Doc = Record<string, any>;
const fresh = (): Doc => ({ _id: convId, type: 'direct', participants: [alice, bob], lastMessage: null, lastMessageAt: null, cursors: {}, createdAt: new Date() });
let conversation = fresh();
const messages: Doc[] = [];
const lastSeen: Record<string, Date> = {};

const snapshot = () => ({ ...conversation, cursors: Object.fromEntries(Object.entries(conversation['cursors']).map(([k, v]) => [k, { ...(v as object) }])) });
function applyUpdate(update: Doc) {
  Object.assign(conversation, update.$set ?? {});
  for (const [path, value] of Object.entries<any>(update.$max ?? {})) {
    const [, uid, field] = path.split('.') as [string, string, string];
    const cursor = (conversation['cursors'][uid] ??= {});
    if (!cursor[field] || String(value) > String(cursor[field])) cursor[field] = value;
  }
}
const includes = (id: unknown) => conversation['participants'].some((p: Types.ObjectId) => String(p) === String(id));

vi.mock('../src/models/conversation.model', () => ({
  Conversation: {
    findOne: (f: Doc) =>
      lean(
        String(f['_id']) === String(convId) && includes(f['participants']) && !(f['lastMessageAt']?.$ne === null && !conversation['lastMessageAt'])
          ? snapshot()
          : null
      ),
    findById: () => lean(snapshot()),
    findOneAndUpdate: (_f: unknown, update: Doc) => (applyUpdate(update), lean(snapshot())),
    findByIdAndUpdate: (_id: unknown, update: Doc) => (applyUpdate(update), lean(snapshot())),
    find: (f: Doc) => {
      const me = f['participants'];
      const established = !conversation['lastMessageAt'];
      const fromOther = f['lastMessage.senderId'] && String(conversation['lastMessage']?.senderId) === String(f['lastMessage.senderId'].$ne);
      return lean(includes(me) && !established && !fromOther ? [snapshot()] : []);
    }
  }
}));
vi.mock('../src/models/message.model', () => ({
  Message: {
    create: async (doc: Doc) => {
      if (messages.some((m) => String(m['senderId']) === String(doc['senderId']) && m['clientMessageId'] === doc['clientMessageId'])) {
        throw Object.assign(new Error('dup'), { code: 11000 });
      }
      const stored = { _id: new Types.ObjectId(), createdAt: new Date(), ...doc };
      messages.push(stored);
      return { toObject: () => stored };
    },
    findOne: (f: Doc) =>
      lean(
        messages.find((m) =>
          f['_id'] ? String(m['_id']) === String(f['_id']) && String(m['conversationId']) === String(f['conversationId'])
                   : String(m['senderId']) === String(f['senderId']) && m['clientMessageId'] === f['clientMessageId']
        ) ?? null
      ),
    countDocuments: async (f: Doc) =>
      messages.filter(
        (m) => String(m['senderId']) !== String(f['senderId'].$ne) && (!f['_id'] || String(m['_id']) > String(f['_id'].$gt))
      ).length
  }
}));
vi.mock('../src/models/user.model', () => ({
  User: {
    find: () => lean([{ _id: alice, displayName: 'Alice', lastSeenAt: lastSeen['alice'] }, { _id: bob, displayName: 'Bob', lastSeenAt: lastSeen['bob'] }]),
    updateOne: async (f: Doc, u: Doc) => void (lastSeen[String(f['_id']) === String(alice) ? 'alice' : 'bob'] = u.$set.lastSeenAt)
  }
}));

const { createSocketServer } = await import('../src/socket/socket');

let server: http.Server;
let io: ReturnType<typeof createSocketServer>;
let url: string;
const open: Socket[] = [];

const client = async (token?: string) => {
  const socket = connect(url, { auth: token ? { token } : {}, transports: ['websocket'], reconnection: false });
  open.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.on('system:ready', () => resolve());
    socket.on('connect_error', reject);
  });
  return socket;
};
const once = <T>(socket: Socket, event: string) => new Promise<T>((resolve) => socket.once(event, resolve));
const send = (socket: Socket, payload: unknown) => socket.emitWithAck('message:send', payload);
const valid = (over = {}) => ({ conversationId: String(convId), clientMessageId: 'client-msg-1', text: 'hello bob', ...over });

beforeAll(async () => {
  server = http.createServer();
  io = createSocketServer(server, { presenceGraceMs: 60 });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  url = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  open.splice(0).forEach((s) => s.close());
  await new Promise((r) => setTimeout(r, 150)); // let presence grace periods expire between tests
  messages.length = 0;
  conversation = fresh();
  for (const k of Object.keys(lastSeen)) delete lastSeen[k];
});

afterAll(() => {
  io.close();
  server.close();
});

describe('socket handshake auth', () => {
  it('accepts a valid token and announces readiness', async () => {
    const socket = connect(url, { auth: { token: 'alice' }, transports: ['websocket'] });
    open.push(socket);
    const ready = await once<{ firebaseUid: string }>(socket, 'system:ready');
    expect(ready.firebaseUid).toBe('alice');
  });

  it.each([{}, { token: 'bad' }])('rejects handshake %j', async (auth) => {
    const socket = connect(url, { auth, transports: ['websocket'], reconnection: false });
    open.push(socket);
    const err = await new Promise<Error>((resolve) => socket.on('connect_error', resolve));
    expect(err.message).toBe('UNAUTHORIZED');
  });
});

describe('message:send', () => {
  it('acks the sender and pushes message:new and conversation:updated to the recipient and the sender', async () => {
    const [a, b] = [await client('alice'), await client('bob')];
    const bobMessage = once<{ message: { text: string; senderId: string } }>(b, 'message:new');
    const bobConversation = once<{ conversation: { participant: { displayName: string }; lastMessage: { text: string } } }>(b, 'conversation:updated');
    const aliceMessage = once<{ message: { clientMessageId: string } }>(a, 'message:new');

    const ack = await send(a, valid());
    expect(ack).toMatchObject({ ok: true, duplicate: false, message: { text: 'hello bob', senderId: String(alice) } });

    expect((await bobMessage).message).toMatchObject({ text: 'hello bob', senderId: String(alice) });
    const { conversation: forBob } = await bobConversation;
    expect(forBob.participant.displayName).toBe('Alice');
    expect(forBob.lastMessage.text).toBe('hello bob');
    expect((await aliceMessage).message.clientMessageId).toBe('client-msg-1');
  });

  it('reaches every connected tab of the recipient', async () => {
    const a = await client('alice');
    const [b1, b2] = [await client('bob'), await client('bob')];
    const got = Promise.all([once(b1, 'message:new'), once(b2, 'message:new')]);
    await send(a, valid());
    await expect(got).resolves.toHaveLength(2);
  });

  it('is idempotent: a retry is acked as duplicate and not broadcast again', async () => {
    const [a, b] = [await client('alice'), await client('bob')];
    const received = vi.fn();
    b.on('message:new', received);
    await send(a, valid());
    const retry = await send(a, valid());
    await new Promise((r) => setTimeout(r, 50));
    expect(retry).toMatchObject({ ok: true, duplicate: true });
    expect(messages).toHaveLength(1);
    expect(received).toHaveBeenCalledTimes(1);
  });

  it('ignores a spoofed senderId in the payload', async () => {
    const a = await client('alice');
    const ack = await send(a, valid({ senderId: String(bob) }));
    expect(ack.message.senderId).toBe(String(alice));
  });

  it('refuses a user who is not in the conversation, and nothing is stored or delivered', async () => {
    const [b, c] = [await client('bob'), await client('carol')];
    const received = vi.fn();
    b.on('message:new', received);
    const ack = await send(c, valid());
    await new Promise((r) => setTimeout(r, 50));
    expect(ack).toEqual({ ok: false, error: { code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found.' } });
    expect(messages).toHaveLength(0);
    expect(received).not.toHaveBeenCalled();
  });

  it.each([
    ['empty text', { text: '   ' }],
    ['over-long text', { text: 'x'.repeat(2001) }],
    ['bad conversation id', { conversationId: 'nope' }],
    ['short client id', { clientMessageId: 'x' }]
  ])('rejects %s with VALIDATION_ERROR', async (_name, over) => {
    const a = await client('alice');
    const ack = await send(a, valid(over));
    expect(ack.ok).toBe(false);
    expect(ack.error.code).toBe('VALIDATION_ERROR');
    expect(messages).toHaveLength(0);
  });

  it('rate-limits a flooding socket', async () => {
    const a = await client('alice');
    const acks = await Promise.all(Array.from({ length: 25 }, (_, i) => send(a, valid({ clientMessageId: `client-msg-${i + 100}` }))));
    expect(acks.filter((x) => x.ok)).toHaveLength(20);
    expect(acks.filter((x) => !x.ok && x.error.code === 'RATE_LIMITED')).toHaveLength(5);
  });

  it('does not crash when the client sends without an ack callback', async () => {
    const a = await client('alice');
    a.emit('message:send', valid());
    await new Promise((r) => setTimeout(r, 50));
    expect(messages).toHaveLength(1);
  });
});

const waitFor = (ms = 80) => new Promise((r) => setTimeout(r, ms));
/** Alice sends one message so the conversation counts as established (presence, typing). */
const establish = async (a: Socket) => {
  const { message } = await send(a, valid({ clientMessageId: 'establish-1' }));
  await waitFor(); // the recipient's copy of the push travels on another socket and may land after the ack
  return message as { id: string };
};

describe('receipts', () => {
  it('marks a message delivered at once when the recipient is connected', async () => {
    const [a] = [await client('alice'), await client('bob')];
    const updated = once<{ conversation: { peerReceipts: { deliveredUpTo: string | null; readUpTo: string | null } } }>(a, 'conversation:updated');
    const { message } = await send(a, valid());
    expect((await updated).conversation.peerReceipts).toEqual({ deliveredUpTo: message.id, readUpTo: null });
  });

  it('leaves it undelivered while the recipient is away, then delivers on their next connection', async () => {
    const a = await client('alice');
    const first = once<{ conversation: { peerReceipts: { deliveredUpTo: string | null } } }>(a, 'conversation:updated');
    const { message } = await send(a, valid());
    expect((await first).conversation.peerReceipts.deliveredUpTo).toBeNull();

    const receipt = once<{ userId: string; deliveredUpTo: string; readUpTo: string | null }>(a, 'receipt:update');
    await client('bob');
    expect(await receipt).toEqual({ conversationId: String(convId), userId: String(bob), deliveredUpTo: message.id, readUpTo: null });
  });

  it('counts unread for the recipient only, and sending counts as having read', async () => {
    const [a, b] = [await client('alice'), await client('bob')];
    const forBob = once<{ conversation: { unreadCount: number } }>(b, 'conversation:updated');
    const forAlice = once<{ conversation: { unreadCount: number } }>(a, 'conversation:updated');
    await send(a, valid());
    expect((await forBob).conversation.unreadCount).toBe(1);
    expect((await forAlice).conversation.unreadCount).toBe(0);
  });

  it('read: tells the peer, clears the reader\'s unread count and is idempotent', async () => {
    const [a, b] = [await client('alice'), await client('bob')];
    const { id } = await establish(a);
    const receipt = once<{ userId: string; readUpTo: string; deliveredUpTo: string }>(a, 'receipt:update');
    const mine = once<{ conversation: { unreadCount: number } }>(b, 'conversation:updated');

    const ack = await b.emitWithAck('message:read', { conversationId: String(convId), messageId: id });
    expect(ack).toEqual({ ok: true, changed: true });
    expect(await receipt).toMatchObject({ userId: String(bob), readUpTo: id, deliveredUpTo: id });
    expect((await mine).conversation.unreadCount).toBe(0);

    const events = vi.fn();
    a.on('receipt:update', events);
    expect(await b.emitWithAck('message:read', { conversationId: String(convId), messageId: id })).toEqual({ ok: true, changed: false });
    await waitFor();
    expect(events).not.toHaveBeenCalled();
  });

  it('read cursors never move backwards', async () => {
    const [a, b] = [await client('alice'), await client('bob')];
    const m1 = await establish(a);
    const m2 = (await send(a, valid({ clientMessageId: 'second-msg-1' }))).message;
    await b.emitWithAck('message:read', { conversationId: String(convId), messageId: m2.id });
    expect(await b.emitWithAck('message:read', { conversationId: String(convId), messageId: m1.id })).toEqual({ ok: true, changed: false });
    expect(conversation['cursors'][String(bob)].readUpTo).toEqual(expect.anything());
    expect(String(conversation['cursors'][String(bob)].readUpTo)).toBe(m2.id);
  });

  it.each([
    ['a stranger', 'carol', {}, 'CONVERSATION_NOT_FOUND'],
    ['an unknown message', 'bob', { messageId: String(new Types.ObjectId()) }, 'MESSAGE_NOT_FOUND'],
    ['a malformed id', 'bob', { messageId: 'zz' }, 'VALIDATION_ERROR']
  ])('read refuses %s', async (_name, who, over, code) => {
    const a = await client('alice');
    const reader = await client(who);
    const { id } = await establish(a);
    const ack = await reader.emitWithAck('message:read', { conversationId: String(convId), messageId: id, ...over });
    expect(ack.ok).toBe(false);
    expect(ack.error.code).toBe(code);
  });
});

describe('presence', () => {
  it('tells established contacts when someone goes offline (with last seen) and when they return', async () => {
    const a = await client('alice');
    const b = await client('bob');
    await establish(a);
    const offline = once<{ userId: string; online: boolean; lastSeenAt: string }>(a, 'presence:update');
    b.close();
    const gone = await offline;
    expect(gone).toMatchObject({ userId: String(bob), online: false });
    expect(new Date(gone.lastSeenAt).getTime()).toBeGreaterThan(0);
    expect(lastSeen['bob']).toBeInstanceOf(Date);

    const online = once<{ userId: string; online: boolean }>(a, 'presence:update');
    await client('bob');
    expect(await online).toMatchObject({ userId: String(bob), online: true });
  });

  it('does not flash offline when a user reloads within the grace period', async () => {
    const a = await client('alice');
    const b = await client('bob');
    await establish(a);
    const events = vi.fn();
    a.on('presence:update', events);
    b.close();
    await waitFor(20);
    await client('bob');
    await waitFor(200);
    expect(events).not.toHaveBeenCalled();
  });

  it('shares no presence before the two have exchanged a message', async () => {
    const a = await client('alice');
    const events = vi.fn();
    a.on('presence:update', events);
    (await client('bob')).close();
    await waitFor(200);
    expect(events).not.toHaveBeenCalled();
  });

  it('shows presence in conversation views only once a message exists', async () => {
    const [a, b] = [await client('alice'), await client('bob')];
    const view = once<{ conversation: { participant: { presence: { online: boolean } | null } } }>(a, 'conversation:updated');
    await send(a, valid());
    expect((await view).conversation.participant.presence).toMatchObject({ online: true });
    b.close();
  });
});

describe('typing', () => {
  it('relays to the other participant only, and only once a message exists', async () => {
    const [a, b] = [await client('alice'), await client('bob')];
    const bobGot = vi.fn();
    b.on('typing:update', bobGot);

    a.emit('typing:start', { conversationId: String(convId) });
    await waitFor();
    expect(bobGot).not.toHaveBeenCalled(); // not established yet

    await establish(a);
    const aliceGot = vi.fn();
    a.on('typing:update', aliceGot);
    const update = once<{ conversationId: string; userId: string; typing: boolean }>(b, 'typing:update');
    a.emit('typing:start', { conversationId: String(convId) });
    expect(await update).toEqual({ conversationId: String(convId), userId: String(alice), typing: true });

    const stop = once<{ typing: boolean }>(b, 'typing:update');
    a.emit('typing:stop', { conversationId: String(convId) });
    expect((await stop).typing).toBe(false);
    expect(aliceGot).not.toHaveBeenCalled();
  });

  it('ignores strangers and malformed payloads without breaking the connection', async () => {
    const [a, b, c] = [await client('alice'), await client('bob'), await client('carol')];
    await establish(a);
    const got = vi.fn();
    b.on('typing:update', got);
    c.emit('typing:start', { conversationId: String(convId) });
    a.emit('typing:start', { conversationId: 'nope' });
    a.emit('typing:start', null);
    a.emit('typing:start');
    await waitFor(150);
    expect(got).not.toHaveBeenCalled();
    expect(a.connected).toBe(true);
  });
});

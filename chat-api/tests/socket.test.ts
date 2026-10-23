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

// Minimal in-memory stand-ins for the models used by the send path.
const lean = <T>(value: T) => ({ lean: async () => value });
const conversation = { _id: convId, type: 'direct', participants: [alice, bob], lastMessage: null, lastMessageAt: null, createdAt: new Date() };
const messages: Array<Record<string, unknown>> = [];
vi.mock('../src/models/conversation.model', () => ({
  Conversation: {
    findOne: (filter: { _id: string; participants: Types.ObjectId }) =>
      lean(String(filter._id) === String(convId) && conversation.participants.some((p) => p.equals(filter.participants)) ? conversation : null),
    findOneAndUpdate: (_f: unknown, update: { $set: Record<string, unknown> }) => lean({ ...conversation, ...update.$set }),
    findById: () => lean(conversation)
  }
}));
vi.mock('../src/models/message.model', () => ({
  Message: {
    create: async (doc: Record<string, unknown>) => {
      if (messages.some((m) => String(m['senderId']) === String(doc['senderId']) && m['clientMessageId'] === doc['clientMessageId'])) {
        throw Object.assign(new Error('dup'), { code: 11000 });
      }
      const stored = { _id: new Types.ObjectId(), createdAt: new Date(), ...doc };
      messages.push(stored);
      return { toObject: () => stored };
    },
    findOne: (f: { senderId: Types.ObjectId; clientMessageId: string }) =>
      lean(messages.find((m) => String(m['senderId']) === String(f.senderId) && m['clientMessageId'] === f.clientMessageId) ?? null)
  }
}));
vi.mock('../src/models/user.model', () => ({
  User: { find: () => lean([{ _id: alice, displayName: 'Alice' }, { _id: bob, displayName: 'Bob' }]) }
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
  io = createSocketServer(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  url = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  open.splice(0).forEach((s) => s.close());
  messages.length = 0;
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

import { Types } from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const me = new Types.ObjectId();
const other = new Types.ObjectId();
const convId = new Types.ObjectId();

vi.mock('../src/config/firebase', () => ({
  firebaseAuth: () => ({ verifyIdToken: async () => ({ uid: 'me', email: 'me@x.com', name: 'Me' }) })
}));
vi.mock('../src/middleware/profile', () => ({
  requireProfile: (req: { profileId?: Types.ObjectId }, _res: unknown, next: () => void) => {
    req.profileId = me;
    next();
  }
}));

const emitToUser = vi.fn();
vi.mock('../src/socket/realtime', () => ({ emitToUser, setRealtimeServer: vi.fn(), personalRoom: (id: unknown) => `user:${id}` }));

const convFindOne = vi.fn();
const convUpdate = vi.fn();
const convFindById = vi.fn();
vi.mock('../src/models/conversation.model', () => ({
  Conversation: { findOne: convFindOne, findOneAndUpdate: convUpdate, findById: convFindById }
}));
const msgCreate = vi.fn();
const msgFindOne = vi.fn();
const msgFind = vi.fn();
vi.mock('../src/models/message.model', () => ({ Message: { create: msgCreate, findOne: msgFindOne, find: msgFind } }));
const userFind = vi.fn();
vi.mock('../src/models/user.model', () => ({ User: { find: userFind } }));

const { createApp } = await import('../src/app');
const app = createApp();
const url = `/api/v1/conversations/${convId}/messages`;
const auth = (r: request.Test) => r.set('Authorization', 'Bearer t');
const lean = <T>(value: T) => ({ lean: async () => value });

const conversation = { _id: convId, type: 'direct', participants: [me, other], lastMessage: null, lastMessageAt: null, createdAt: new Date('2026-01-01') };
const stored = (over = {}) => ({
  _id: new Types.ObjectId(),
  conversationId: convId,
  senderId: me,
  clientMessageId: 'client-msg-1',
  text: 'hello',
  createdAt: new Date('2026-02-01'),
  ...over
});
const body = { clientMessageId: 'client-msg-1', text: '  hello  ' };

beforeEach(() => {
  vi.clearAllMocks();
  convFindOne.mockReturnValue(lean(conversation));
  const doc = stored();
  msgCreate.mockResolvedValue({ toObject: () => doc });
  convUpdate.mockReturnValue(lean({ ...conversation, lastMessage: { text: 'hello', senderId: me, sentAt: doc.createdAt }, lastMessageAt: doc.createdAt }));
  userFind.mockReturnValue(lean([{ _id: me, displayName: 'Me' }, { _id: other, displayName: 'Grace' }]));
});

describe('POST /conversations/:id/messages', () => {
  it('requires auth', async () => {
    expect((await request(app).post(url).send(body)).status).toBe(401);
  });

  it.each([
    {},
    { text: 'hi' },
    { clientMessageId: 'short', text: 'hi' },
    { clientMessageId: 'has spaces in it', text: 'hi' },
    { clientMessageId: 'client-msg-1', text: '   ' },
    { clientMessageId: 'client-msg-1', text: 'x'.repeat(2001) }
  ])('rejects invalid body %j', async (payload) => {
    const res = await auth(request(app).post(url)).send(payload);
    expect(res.status).toBe(400);
    expect(msgCreate).not.toHaveBeenCalled();
  });

  it('404s for a conversation the caller is not in, scoped by participants', async () => {
    convFindOne.mockReturnValue(lean(null));
    const res = await auth(request(app).post(url)).send(body);
    expect(res.status).toBe(404);
    expect(convFindOne).toHaveBeenCalledWith({ _id: String(convId), participants: me });
    expect(msgCreate).not.toHaveBeenCalled();
  });

  it('stores the trimmed text with the caller as sender and returns 201', async () => {
    const res = await auth(request(app).post(url)).send({ ...body, senderId: String(other) });
    expect(res.status).toBe(201);
    expect(msgCreate).toHaveBeenCalledWith({ conversationId: convId, senderId: me, clientMessageId: 'client-msg-1', text: 'hello' });
    expect(res.body.data).toMatchObject({ text: 'hello', conversationId: String(convId), senderId: String(me) });
  });

  it('notifies both participants with their own view of the conversation', async () => {
    await auth(request(app).post(url)).send(body);
    const events = emitToUser.mock.calls.map(([id, event]) => `${id}:${event}`);
    expect(events).toEqual([
      `${me}:message:new`,
      `${me}:conversation:updated`,
      `${other}:message:new`,
      `${other}:conversation:updated`
    ]);
    const forMe = emitToUser.mock.calls.find(([id, event]) => id === me && event === 'conversation:updated')![2];
    const forOther = emitToUser.mock.calls.find(([id, event]) => id === other && event === 'conversation:updated')![2];
    expect(forMe.conversation.participant.displayName).toBe('Grace');
    expect(forOther.conversation.participant.displayName).toBe('Me');
    expect(forOther.conversation.lastMessage.text).toBe('hello');
  });

  it('only advances the conversation preview', async () => {
    await auth(request(app).post(url)).send(body);
    const [filter] = convUpdate.mock.calls[0]!;
    expect(filter.$or).toEqual([{ lastMessageAt: null }, { lastMessageAt: { $lt: expect.any(Date) } }]);
  });

  it('is idempotent: a repeated clientMessageId returns 200 and does not broadcast', async () => {
    const existing = stored();
    msgCreate.mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));
    msgFindOne.mockReturnValue(lean(existing));
    const res = await auth(request(app).post(url)).send(body);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(String(existing._id));
    expect(emitToUser).not.toHaveBeenCalled();
    expect(msgFindOne).toHaveBeenCalledWith({ senderId: me, clientMessageId: 'client-msg-1' });
  });

  it('409s when the clientMessageId was used in a different conversation', async () => {
    msgCreate.mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));
    msgFindOne.mockReturnValue(lean(stored({ conversationId: new Types.ObjectId() })));
    const res = await auth(request(app).post(url)).send(body);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CLIENT_MESSAGE_ID_REUSED');
  });

  it('still succeeds when the broadcast fails after the message was stored', async () => {
    userFind.mockImplementation(() => {
      throw new Error('db down');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await auth(request(app).post(url)).send(body)).status).toBe(201);
  });
});

describe('GET /conversations/:id/messages', () => {
  const chain = (rows: unknown[]) => {
    const q: Record<string, unknown> = {};
    for (const m of ['sort', 'limit']) q[m] = () => q;
    q['lean'] = async () => rows;
    return q;
  };

  it('404s for non-participants without querying messages', async () => {
    convFindOne.mockReturnValue(lean(null));
    expect((await auth(request(app).get(url))).status).toBe(404);
    expect(msgFind).not.toHaveBeenCalled();
  });

  it('returns a page oldest-first and reports hasMore from the extra row', async () => {
    const [newest, middle, oldest] = [stored({ text: 'c' }), stored({ text: 'b' }), stored({ text: 'a' })];
    msgFind.mockReturnValue(chain([newest, middle, oldest]));
    const res = await auth(request(app).get(`${url}?limit=2`));
    expect(res.status).toBe(200);
    expect(res.body.data.map((m: { text: string }) => m.text)).toEqual(['b', 'c']);
    expect(res.body.meta).toEqual({ limit: 2, hasMore: true });
  });

  it('pages backwards with the before cursor', async () => {
    msgFind.mockReturnValue(chain([]));
    const before = String(new Types.ObjectId());
    await auth(request(app).get(`${url}?before=${before}`));
    expect(msgFind).toHaveBeenCalledWith({ conversationId: String(convId), _id: { $lt: before } });
  });

  it.each(['limit=0', 'limit=101', 'before=zzz'])('rejects %s', async (qs) => {
    expect((await auth(request(app).get(`${url}?${qs}`))).status).toBe(400);
  });
});

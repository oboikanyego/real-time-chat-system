import { Types } from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const me = new Types.ObjectId();
const other = new Types.ObjectId();

vi.mock('../src/config/firebase', () => ({
  firebaseAuth: () => ({ verifyIdToken: async () => ({ uid: 'me', email: 'me@x.com', name: 'Me' }) })
}));
vi.mock('../src/middleware/profile', () => ({
  requireProfile: (req: { profileId?: Types.ObjectId }, _res: unknown, next: () => void) => {
    req.profileId = me;
    next();
  }
}));

const findOneAndUpdate = vi.fn();
const find = vi.fn();
const findOne = vi.fn();
vi.mock('../src/models/conversation.model', () => ({ Conversation: { findOneAndUpdate, find, findOne } }));
const msgCount = vi.fn();
vi.mock('../src/models/message.model', () => ({ Message: { countDocuments: msgCount } }));
const userFindById = vi.fn();
const userFind = vi.fn();
vi.mock('../src/models/user.model', () => ({ User: { findById: userFindById, find: userFind } }));

const { createApp } = await import('../src/app');
const { directKeyFor, toConversationView } = await import('../src/services/conversation.service');
const app = createApp();
const auth = (r: request.Test) => r.set('Authorization', 'Bearer t');

const lean = <T>(value: T) => ({ lean: async () => value });
const chain = (rows: unknown[]) => {
  const q: Record<string, unknown> = {};
  for (const m of ['sort', 'skip', 'limit']) q[m] = () => q;
  q['lean'] = async () => rows;
  return q;
};
const conv = (over = {}) => ({
  _id: new Types.ObjectId(),
  type: 'direct',
  participants: [me, other],
  lastMessage: null,
  lastMessageAt: null,
  createdAt: new Date('2026-01-01'),
  ...over
});
const upsertResult = (doc: ReturnType<typeof conv>, updatedExisting: boolean) => ({
  value: { toObject: () => doc },
  lastErrorObject: { updatedExisting }
});

beforeEach(() => {
  vi.clearAllMocks();
  userFindById.mockReturnValue(lean({ _id: other, displayName: 'Grace', photoURL: undefined }));
  userFind.mockReturnValue(lean([{ _id: other, displayName: 'Grace' }]));
});

describe('directKeyFor', () => {
  it('is order independent', () => {
    expect(directKeyFor(me, other)).toBe(directKeyFor(other, me));
  });
});

describe('toConversationView', () => {
  it('inlines the other participant and hides messages that do not exist yet', () => {
    const view = toConversationView(conv(), me, new Map([[String(other), { id: String(other), displayName: 'Grace', photoURL: null }]]));
    expect(view.participant.displayName).toBe('Grace');
    expect(view.lastMessage).toBeNull();
  });

  it('falls back when the other user no longer exists', () => {
    expect(toConversationView(conv(), me, new Map()).participant.displayName).toBe('Unknown user');
  });
});

describe('POST /api/v1/conversations', () => {
  const post = (body: unknown) => auth(request(app).post('/api/v1/conversations')).send(body as object);

  it('requires auth', async () => {
    expect((await request(app).post('/api/v1/conversations').send({ userId: String(other) })).status).toBe(401);
  });

  it.each([{}, { userId: 'nope' }, { userId: 123 }])('rejects invalid body %j', async (body) => {
    expect((await post(body)).status).toBe(400);
  });

  it('refuses a conversation with yourself', async () => {
    const res = await post({ userId: String(me) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARTICIPANT');
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('404s for an unknown user', async () => {
    userFindById.mockReturnValue(lean(null));
    expect((await post({ userId: String(other) })).status).toBe(404);
  });

  it('creates with 201 using a deterministic key', async () => {
    findOneAndUpdate.mockResolvedValue(upsertResult(conv(), false));
    const res = await post({ userId: String(other) });
    expect(res.status).toBe(201);
    expect(res.body.data.participant).toMatchObject({ id: String(other), displayName: 'Grace' });
    const [filter, update] = findOneAndUpdate.mock.calls[0]!;
    expect(filter).toEqual({ directKey: directKeyFor(me, other) });
    expect(update.$addToSet).toEqual({ openedBy: me });
  });

  it('returns 200 for an existing conversation', async () => {
    findOneAndUpdate.mockResolvedValue(upsertResult(conv(), true));
    expect((await post({ userId: String(other) })).status).toBe(200);
  });

  it('retries once when a concurrent request wins the unique index', async () => {
    findOneAndUpdate.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 11000 })).mockResolvedValueOnce(upsertResult(conv(), true));
    expect((await post({ userId: String(other) })).status).toBe(200);
    expect(findOneAndUpdate).toHaveBeenCalledTimes(2);
  });
});

describe('GET /api/v1/conversations', () => {
  it('lists visible conversations for the caller only', async () => {
    find.mockReturnValue(chain([conv()]));
    const res = await auth(request(app).get('/api/v1/conversations'));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta).toEqual({ page: 1, limit: 30, hasMore: false });
    expect(find.mock.calls[0]![0]).toEqual({
      participants: me,
      $or: [{ openedBy: me }, { lastMessageAt: { $ne: null } }]
    });
  });

  it('reports hasMore using the extra row', async () => {
    find.mockReturnValue(chain([conv(), conv(), conv()]));
    const res = await auth(request(app).get('/api/v1/conversations?limit=2'));
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.hasMore).toBe(true);
  });

  it('rejects a bad limit', async () => {
    expect((await auth(request(app).get('/api/v1/conversations?limit=500'))).status).toBe(400);
  });
});

describe('receipt and presence fields in conversation views', () => {
  const when = new Date('2026-03-01');
  const established = (over = {}) =>
    conv({ lastMessageAt: when, lastMessage: { text: 'hey', senderId: other, sentAt: when, messageId: new Types.ObjectId() }, ...over });

  it('withholds presence until a message exists, and shows last seen afterwards', async () => {
    const stranger = new Types.ObjectId(); // a direct conversation is unique per pair, so each one has its own other person
    userFind.mockReturnValue(lean([{ _id: other, displayName: 'Grace', lastSeenAt: when }, { _id: stranger, displayName: 'Ada', lastSeenAt: when }]));
    find.mockReturnValue(chain([established(), conv({ participants: [me, stranger] })]));
    const res = await auth(request(app).get('/api/v1/conversations'));
    expect(res.body.data[0].participant.presence).toEqual({ online: false, lastSeenAt: when.toISOString() });
    expect(res.body.data[1].participant.presence).toBeNull();
  });

  it('reports unread for the viewer, counting only the other person\'s messages after the read cursor', async () => {
    const readUpTo = new Types.ObjectId();
    msgCount.mockResolvedValue(3);
    find.mockReturnValue(chain([established({ cursors: { [String(me)]: { readUpTo } } })]));
    const res = await auth(request(app).get('/api/v1/conversations'));
    expect(res.body.data[0].unreadCount).toBe(3);
    const [filter, options] = msgCount.mock.calls[0]!;
    expect(filter).toMatchObject({ senderId: { $ne: me }, _id: { $gt: readUpTo } });
    expect(options).toEqual({ limit: 100 });
  });

  it('does not count anything for a conversation without messages', async () => {
    find.mockReturnValue(chain([conv()]));
    const res = await auth(request(app).get('/api/v1/conversations'));
    expect(res.body.data[0].unreadCount).toBe(0);
    expect(msgCount).not.toHaveBeenCalled();
  });

  it("exposes the peer's receipts so the sender can show Delivered/Read", async () => {
    const delivered = new Types.ObjectId();
    const read = new Types.ObjectId();
    find.mockReturnValue(chain([established({ cursors: { [String(other)]: { deliveredUpTo: delivered, readUpTo: read } } })]));
    const res = await auth(request(app).get('/api/v1/conversations'));
    expect(res.body.data[0].peerReceipts).toEqual({ deliveredUpTo: String(delivered), readUpTo: String(read) });
    expect(res.body.data[0].lastMessage.id).toBeTruthy();
  });
});

describe('GET /api/v1/conversations/:id', () => {
  it('scopes the lookup to the caller and 404s otherwise', async () => {
    const id = String(new Types.ObjectId());
    findOne.mockReturnValue(lean(null));
    expect((await auth(request(app).get(`/api/v1/conversations/${id}`))).status).toBe(404);
    expect(findOne).toHaveBeenCalledWith({ _id: id, participants: me });
  });

  it('404s on a malformed id without querying', async () => {
    expect((await auth(request(app).get('/api/v1/conversations/xyz'))).status).toBe(404);
    expect(findOne).not.toHaveBeenCalled();
  });

  it('returns the conversation to a participant', async () => {
    const doc = conv();
    findOne.mockReturnValue(lean(doc));
    const res = await auth(request(app).get(`/api/v1/conversations/${doc._id}`));
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(String(doc._id));
  });
});

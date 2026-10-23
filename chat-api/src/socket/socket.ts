import type { Server as HttpServer } from 'http';
import { Server, type Socket } from 'socket.io';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { resolveIdentity, UnauthorizedError } from '../auth/identity';
import { AppError } from '../middleware/error';
import { sendMessage, socketSendSchema } from '../services/message.service';
import { announceOffline, announceOnline, otherParticipantIfEstablished } from '../services/presence.service';
import { markPendingDelivered, markRead, markReadSchema } from '../services/receipt.service';
import { resolveProfileId } from '../services/user.service';
import { createPresenceTracker, setPresenceTracker } from './presence';
import { emitToUser, personalRoom, setRealtimeServer } from './realtime';

const WINDOW_MS = 10_000;

type Ack = (response: { ok: true; [key: string]: unknown } | { ok: false; error: { code: string; message: string } }) => void;

/** Sliding-window limit per socket, so one connection cannot flood the server or a conversation. */
function createLimiter(max: number) {
  let hits: number[] = [];
  return () => {
    const now = Date.now();
    hits = hits.filter((t) => now - t < WINDOW_MS);
    if (hits.length >= max) return false;
    hits.push(now);
    return true;
  };
}

/** Runs a handler that answers with an ack, turning thrown AppErrors into `{ok: false}` replies. */
function respond(ack: unknown, run: () => Promise<Record<string, unknown>>): Promise<void> {
  const reply: Ack = typeof ack === 'function' ? (ack as Ack) : () => undefined;
  return run().then(
    (data) => reply({ ok: true, ...data }),
    (error) => {
      if (error instanceof AppError) return reply({ ok: false, error: { code: error.code, message: error.message } });
      logger.error({ err: error }, 'socket handler failed');
      return reply({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error.' } });
    }
  );
}

const validate = <T>(schema: { validate: (v: unknown, o: object) => { value: T; error?: { details: { message: string }[] } } }, payload: unknown): T => {
  const { value, error } = schema.validate(payload, { abortEarly: false, stripUnknown: true });
  if (error) throw new AppError(400, 'VALIDATION_ERROR', error.details.map((d) => d.message).join('; '));
  return value;
};

function registerHandlers(socket: Socket) {
  const allowSend = createLimiter(20);
  const allowRead = createLimiter(60);
  const allowTyping = createLimiter(40);
  const me = () => socket.data.profileId;

  socket.on('message:send', (payload: unknown, ack?: Ack) =>
    respond(ack, async () => {
      if (!allowSend()) throw new AppError(429, 'RATE_LIMITED', 'You are sending messages too quickly.');
      const { conversationId, ...input } = validate<{ conversationId: string; clientMessageId: string; text: string }>(socketSendSchema, payload);
      // The sender is always the authenticated socket user, never a field from the payload.
      const { message, duplicate } = await sendMessage(me(), conversationId, input);
      return { message, duplicate };
    })
  );

  socket.on('message:read', (payload: unknown, ack?: Ack) =>
    respond(ack, async () => {
      if (!allowRead()) throw new AppError(429, 'RATE_LIMITED', 'Too many read receipts.');
      const { conversationId, messageId } = validate<{ conversationId: string; messageId: string }>(markReadSchema, payload);
      return markRead(me(), conversationId, messageId);
    })
  );

  // Typing indicators are best effort: invalid, unauthorized or excessive events are dropped silently.
  const peers = new Map<string, string>();
  const relayTyping = (typing: boolean) => async (payload: unknown) => {
    const conversationId = (payload as { conversationId?: unknown } | null)?.conversationId;
    if (typeof conversationId !== 'string' || !/^[0-9a-f]{24}$/i.test(conversationId) || !allowTyping()) return;
    try {
      let peer = peers.get(conversationId);
      if (!peer) {
        peer = (await otherParticipantIfEstablished(me(), conversationId)) ?? undefined;
        if (!peer) return;
        peers.set(conversationId, peer);
      }
      emitToUser(peer, 'typing:update', { conversationId, userId: String(me()), typing });
    } catch (error) {
      logger.error({ err: error }, 'typing relay failed');
    }
  };
  socket.on('typing:start', relayTyping(true));
  socket.on('typing:stop', relayTyping(false));
}

export function createSocketServer(httpServer: HttpServer, options: { presenceGraceMs?: number } = {}) {
  const io = new Server(httpServer, {
    cors: { origin: env.clientOrigins, credentials: true },
    transports: ['websocket', 'polling']
  });
  setRealtimeServer(io);

  const presence = createPresenceTracker({
    graceMs: options.presenceGraceMs ?? env.presenceGraceMs,
    onOnline: (id) => void announceOnline(id).catch((e) => logger.error({ err: e }, 'presence online broadcast failed')),
    onOffline: (id) => void announceOffline(id).catch((e) => logger.error({ err: e }, 'presence offline update failed'))
  });
  setPresenceTracker(presence);

  io.use(async (socket, next) => {
    try {
      const { token, devUser } = socket.handshake.auth ?? {};
      const identity = await resolveIdentity(token, devUser);
      socket.data.user = identity;
      socket.data.profileId = await resolveProfileId(identity);
      return next();
    } catch (error) {
      // Only auth failures are final; anything else (e.g. the database) is worth retrying.
      return next(new Error(error instanceof UnauthorizedError ? 'UNAUTHORIZED' : 'SERVER_ERROR'));
    }
  });

  io.on('connection', (socket) => {
    const uid = socket.data.user.firebaseUid as string;
    socket.join([`firebase:${uid}`, personalRoom(socket.data.profileId)]);
    registerHandlers(socket);

    const profileId = String(socket.data.profileId);
    presence.connect(profileId, socket.id);
    socket.on('disconnect', () => presence.disconnect(profileId, socket.id));
    // Anything sent while this user had no socket counts as delivered now.
    void markPendingDelivered(socket.data.profileId).catch((e) => logger.error({ err: e }, 'pending delivery failed'));

    socket.emit('system:ready', { socketId: socket.id, firebaseUid: uid });
  });

  return io;
}

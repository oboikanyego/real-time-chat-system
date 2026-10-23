import type { Server as HttpServer } from 'http';
import { Server, type Socket } from 'socket.io';
import { env } from '../config/env';
import { resolveIdentity, UnauthorizedError } from '../auth/identity';
import { AppError } from '../middleware/error';
import { sendMessage, socketSendSchema } from '../services/message.service';
import { resolveProfileId } from '../services/user.service';
import { personalRoom, setRealtimeServer } from './realtime';

const SEND_LIMIT = { max: 20, windowMs: 10_000 };

type Ack = (response: { ok: true; message: unknown; duplicate: boolean } | { ok: false; error: { code: string; message: string } }) => void;

/** Sliding-window limit per socket, so one connection cannot flood a conversation. */
function createSendLimiter() {
  let sent: number[] = [];
  return () => {
    const now = Date.now();
    sent = sent.filter((t) => now - t < SEND_LIMIT.windowMs);
    if (sent.length >= SEND_LIMIT.max) return false;
    sent.push(now);
    return true;
  };
}

function registerMessageHandlers(socket: Socket) {
  const allow = createSendLimiter();

  socket.on('message:send', async (payload: unknown, ack?: Ack) => {
    const reply: Ack = typeof ack === 'function' ? ack : () => undefined;
    try {
      if (!allow()) throw new AppError(429, 'RATE_LIMITED', 'You are sending messages too quickly.');
      const { value, error } = socketSendSchema.validate(payload, { abortEarly: false, stripUnknown: true });
      if (error) throw new AppError(400, 'VALIDATION_ERROR', error.details.map((d) => d.message).join('; '));

      const { conversationId, ...input } = value;
      // The sender is always the authenticated socket user, never a field from the payload.
      const { message, duplicate } = await sendMessage(socket.data.profileId, conversationId, input);
      reply({ ok: true, message, duplicate });
    } catch (error) {
      if (error instanceof AppError) return reply({ ok: false, error: { code: error.code, message: error.message } });
      console.error('[socket] message:send failed', error);
      reply({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error.' } });
    }
  });
}

export function createSocketServer(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.clientOrigins, credentials: true },
    transports: ['websocket', 'polling']
  });
  setRealtimeServer(io);

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
    registerMessageHandlers(socket);
    socket.emit('system:ready', { socketId: socket.id, firebaseUid: uid });
  });

  return io;
}

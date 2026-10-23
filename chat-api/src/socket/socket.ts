import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { env } from '../config/env';
import { resolveIdentity } from '../auth/identity';

export function createSocketServer(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.clientOrigins, credentials: true },
    transports: ['websocket', 'polling']
  });

  io.use(async (socket, next) => {
    try {
      const { token, devUser } = socket.handshake.auth ?? {};
      socket.data.user = await resolveIdentity(token, devUser);
      return next();
    } catch {
      return next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket) => {
    const uid = socket.data.user.firebaseUid as string;
    socket.join(`firebase:${uid}`);
    socket.emit('system:ready', { socketId: socket.id, firebaseUid: uid });
  });

  return io;
}

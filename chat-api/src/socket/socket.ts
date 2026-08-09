import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { env } from '../config/env';
import { firebaseAuth } from '../config/firebase';

export function createSocketServer(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.clientOrigins, credentials: true },
    transports: ['websocket', 'polling']
  });

  io.use(async (socket, next) => {
    try {
      if (env.authMode === 'development' && env.nodeEnv !== 'production') {
        socket.data.user = { firebaseUid: 'dev-user', email: 'dev@example.com' };
        return next();
      }

      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('UNAUTHORIZED'));
      const decoded = await firebaseAuth()!.verifyIdToken(token);
      socket.data.user = { firebaseUid: decoded.uid, email: decoded.email };
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

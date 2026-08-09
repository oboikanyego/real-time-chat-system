import http from 'http';
import { createApp } from './app';
import { connectMongo, disconnectMongo } from './config/mongo';
import { env } from './config/env';
import { createSocketServer } from './socket/socket';

async function start() {
  await connectMongo();
  const app = createApp();
  const server = http.createServer(app);
  const io = createSocketServer(server);

  server.listen(env.port, '0.0.0.0', () => {
    console.log(`[api] listening on 0.0.0.0:${env.port}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`[api] ${signal} received, shutting down`);
    io.close();
    server.close(async () => {
      await disconnectMongo();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

start().catch((error) => {
  console.error('[api] startup failure', error);
  process.exit(1);
});

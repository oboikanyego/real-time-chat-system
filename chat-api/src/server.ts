import http from 'http';
import { createApp } from './app';
import { env } from './config/env';
import { assertFirebaseConfigured } from './config/firebase';
import { logger } from './config/logger';
import { connectMongo, disconnectMongo } from './config/mongo';
import { createSocketServer } from './socket/socket';

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function start() {
  assertFirebaseConfigured();
  await connectMongo();
  const app = createApp();
  const server = http.createServer(app);
  const io = createSocketServer(server);

  server.listen(env.port, '0.0.0.0', () => {
    logger.info({ port: env.port, env: env.nodeEnv, auth: env.authMode, origins: env.clientOrigins }, 'api listening');
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    // Never hang: keep-alive HTTP connections or a stuck socket must not block a deploy.
    setTimeout(() => {
      logger.warn('shutdown timed out, exiting');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();

    await io.close(); // closes websocket clients and the HTTP server
    server.closeAllConnections();
    await disconnectMongo();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'unhandled rejection'));
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'uncaught exception');
  process.exit(1);
});

start().catch((error) => {
  logger.fatal({ err: error }, 'startup failure');
  process.exit(1);
});

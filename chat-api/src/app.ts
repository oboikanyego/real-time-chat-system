import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env';
import { logger } from './config/logger';
import { isMongoReady } from './config/mongo';
import { openApiDocument } from './docs/openapi';
import { errorHandler } from './middleware/error';
import { conversationsRouter } from './routes/conversations.routes';
import { meRouter } from './routes/me.routes';
import { usersRouter } from './routes/users.routes';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Behind a platform proxy (Render, Fly, ...) the client address comes from X-Forwarded-For. Without this every
  // visitor would share the proxy's address and one rate-limit bucket.
  app.set('trust proxy', env.trustProxy);

  // Health checks are polled constantly by the platform; keep them out of the logs.
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/ready' },
      // One compact line per request: no headers (they carry tokens), no query strings.
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: String(req.url).split('?')[0] }),
        res: (res) => ({ statusCode: res.statusCode })
      },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info')
    })
  );
  app.use(helmet());
  app.use(cors({ origin: env.clientOrigins, credentials: true }));
  app.use(express.json({ limit: '256kb' }));

  // Liveness: the process is up. Used by the platform to decide whether to restart; never depends on the database.
  app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', service: 'real-time-chat-api' }));
  // Readiness: the process can serve traffic (database connected).
  app.get('/ready', (_req, res) => {
    const ready = isMongoReady();
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable', database: ready ? 'up' : 'down' });
  });

  app.use(rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: 'draft-7', legacyHeaders: false }));

  app.use('/api/v1/me', meRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/conversations', conversationsRouter);
  if (env.enableDocs) app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));

  app.use((_req, res) => res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found.' } }));
  app.use(errorHandler);
  return app;
}

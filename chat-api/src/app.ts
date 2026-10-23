import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env';
import { openApiDocument } from './docs/openapi';
import { errorHandler } from './middleware/error';
import { meRouter } from './routes/me.routes';
import { usersRouter } from './routes/users.routes';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.clientOrigins, credentials: true }));
  app.use(express.json({ limit: '256kb' }));
  app.use(rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: 'draft-7', legacyHeaders: false }));

  app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', service: 'real-time-chat-api' }));
  app.use('/api/v1/me', meRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));

  app.use((_req, res) => res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found.' } }));
  app.use(errorHandler);
  return app;
}

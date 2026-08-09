import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env';
import { openApiDocument } from './docs/openapi';
import { requireAuth } from './middleware/auth';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.clientOrigins, credentials: true }));
  app.use(express.json({ limit: '256kb' }));
  app.use(rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: 'draft-7', legacyHeaders: false }));

  app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', service: 'real-time-chat-api' }));
  app.get('/api/v1/me', requireAuth, (req, res) => res.json({ success: true, data: req.user }));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));

  app.use((_req, res) => res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found.' } }));
  return app;
}

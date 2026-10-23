import pino from 'pino';
import { env } from './env';

/**
 * One JSON object per line by default (what log aggregators and `docker logs` expect). Readable output only for a
 * developer running the API in a terminal, so containers never need the dev-only pino-pretty package.
 */
export const logger = pino({
  level: env.logLevel,
  base: { service: 'real-time-chat-api' },
  redact: { paths: ['req.headers.authorization', 'req.headers.cookie'], censor: '[redacted]' },
  ...(env.nodeEnv === 'development' && process.stdout.isTTY ? { transport: { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname,service' } } } : {})
});

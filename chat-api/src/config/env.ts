import 'dotenv/config';
import Joi from 'joi';

const schema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  MONGODB_URI: Joi.string().required(),
  CLIENT_ORIGIN: Joi.string().default('http://localhost:4200'),
  AUTH_MODE: Joi.string().valid('development', 'firebase').default('firebase'),
  FIREBASE_PROJECT_ID: Joi.when('AUTH_MODE', { is: 'firebase', then: Joi.string().required(), otherwise: Joi.string().allow('').optional() }),
  FIREBASE_CLIENT_EMAIL: Joi.when('AUTH_MODE', { is: 'firebase', then: Joi.string().required(), otherwise: Joi.string().allow('').optional() }),
  FIREBASE_PRIVATE_KEY: Joi.when('AUTH_MODE', { is: 'firebase', then: Joi.string().required(), otherwise: Joi.string().allow('').optional() }),
  LOG_LEVEL: Joi.string().valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent').optional(),
  // Number of reverse proxies in front of the API (Render adds one). Needed for correct client IPs and rate limiting.
  TRUST_PROXY: Joi.number().integer().min(0).max(10).optional(),
  ENABLE_DOCS: Joi.boolean().default(true),
  PRESENCE_GRACE_MS: Joi.number().integer().min(0).max(60_000).default(5000)
}).unknown(true);

const { value, error } = schema.validate(process.env, { abortEarly: false });
if (error) {
  throw new Error(`Invalid environment configuration: ${error.message}`);
}

const nodeEnv = value.NODE_ENV as 'development' | 'test' | 'production';
const authMode = value.AUTH_MODE as 'development' | 'firebase';

/**
 * Browser origins have no path and no trailing slash. A pasted "https://app.example.com/" would never match the
 * Origin header and silently break CORS, so normalise and reject anything that is not a plain http(s) origin.
 */
function parseOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((v) => v.trim().replace(/\/+$/, ''))
    .filter(Boolean)
    .map((origin) => {
      let url: URL;
      try {
        url = new URL(origin);
      } catch {
        throw new Error(`Invalid CLIENT_ORIGIN entry "${origin}": expected an origin such as https://app.example.com`);
      }
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
        throw new Error(`Invalid CLIENT_ORIGIN entry "${origin}": use only scheme, host and port (e.g. ${url.origin})`);
      }
      return origin;
    });
}

if (nodeEnv === 'production') {
  // The development login trusts a header, so it must never be reachable in production.
  if (authMode !== 'firebase') throw new Error('AUTH_MODE must be "firebase" when NODE_ENV=production.');
  if (!process.env['CLIENT_ORIGIN']) throw new Error('CLIENT_ORIGIN must be set when NODE_ENV=production.');
}

export const env = {
  nodeEnv,
  port: Number(value.PORT),
  mongoUri: String(value.MONGODB_URI),
  clientOrigins: parseOrigins(String(value.CLIENT_ORIGIN)),
  authMode,
  logLevel: (value.LOG_LEVEL as string | undefined) ?? (nodeEnv === 'test' ? 'silent' : 'info'),
  trustProxy: value.TRUST_PROXY !== undefined ? Number(value.TRUST_PROXY) : nodeEnv === 'production' ? 1 : 0,
  enableDocs: Boolean(value.ENABLE_DOCS),
  presenceGraceMs: Number(value.PRESENCE_GRACE_MS),
  firebase: {
    projectId: value.FIREBASE_PROJECT_ID ? String(value.FIREBASE_PROJECT_ID) : '',
    clientEmail: value.FIREBASE_CLIENT_EMAIL ? String(value.FIREBASE_CLIENT_EMAIL) : '',
    // Hosting dashboards store the key with literal "\n" and often wrap it in quotes; accept both.
    privateKey: value.FIREBASE_PRIVATE_KEY
      ? String(value.FIREBASE_PRIVATE_KEY).trim().replace(/^"|"$/g, '').replace(/\\n/g, '\n')
      : ''
  }
};

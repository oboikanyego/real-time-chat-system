import 'dotenv/config';
import Joi from 'joi';

const schema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  MONGODB_URI: Joi.string().required(),
  MONGODB_DB_NAME: Joi.string().trim().min(1).optional(),
  CLIENT_ORIGIN: Joi.string().default('http://localhost:4200'),
  AUTH_MODE: Joi.string().valid('development', 'firebase').default('firebase'),
  FIREBASE_PROJECT_ID: Joi.when('AUTH_MODE', { is: 'firebase', then: Joi.string().required(), otherwise: Joi.string().allow('').optional() }),
  FIREBASE_CLIENT_EMAIL: Joi.when('AUTH_MODE', { is: 'firebase', then: Joi.string().required(), otherwise: Joi.string().allow('').optional() }),
  FIREBASE_PRIVATE_KEY: Joi.when('AUTH_MODE', { is: 'firebase', then: Joi.string().required(), otherwise: Joi.string().allow('').optional() })
}).unknown(true);

const { value, error } = schema.validate(process.env, { abortEarly: false });
if (error) {
  throw new Error(`Invalid environment configuration: ${error.message}`);
}

export const env = {
  nodeEnv: value.NODE_ENV as 'development' | 'test' | 'production',
  port: Number(value.PORT),
  mongoUri: String(value.MONGODB_URI),
  mongoDbName: value.MONGODB_DB_NAME ? String(value.MONGODB_DB_NAME) : undefined,
  clientOrigins: String(value.CLIENT_ORIGIN).split(',').map((v) => v.trim()).filter(Boolean),
  authMode: value.AUTH_MODE as 'development' | 'firebase',
  firebase: {
    projectId: value.FIREBASE_PROJECT_ID ? String(value.FIREBASE_PROJECT_ID) : '',
    clientEmail: value.FIREBASE_CLIENT_EMAIL ? String(value.FIREBASE_CLIENT_EMAIL) : '',
    privateKey: value.FIREBASE_PRIVATE_KEY ? String(value.FIREBASE_PRIVATE_KEY).replace(/\\n/g, '\n') : ''
  }
};

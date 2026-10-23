import mongoose from 'mongoose';
import { env } from './env';
import { logger } from './logger';

export async function connectMongo(): Promise<void> {
  mongoose.connection.on('disconnected', () => logger.warn('mongo disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('mongo reconnected'));
  // Fail startup within seconds on a wrong URI or an IP allow-list problem instead of hanging for 30 s.
  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 10_000 });
  logger.info('mongo connected');
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}

export const isMongoReady = (): boolean => mongoose.connection.readyState === 1;

import mongoose from 'mongoose';
import { env } from './env';

export async function connectMongo(): Promise<void> {
  await mongoose.connect(env.mongoUri, env.mongoDbName ? { dbName: env.mongoDbName } : {});
  console.log('[mongo] connected');
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}

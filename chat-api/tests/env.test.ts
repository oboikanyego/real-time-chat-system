import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEYS = ['NODE_ENV', 'MONGODB_URI', 'CLIENT_ORIGIN', 'AUTH_MODE', 'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'TRUST_PROXY', 'LOG_LEVEL'];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  vi.resetModules();
});
afterEach(() => {
  for (const k of KEYS) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
});

async function load(vars: Record<string, string | undefined>) {
  vi.resetModules();
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, { MONGODB_URI: 'mongodb://x/db', ...vars });
  for (const k of KEYS) if (process.env[k] === undefined) delete process.env[k];
  return (await import('../src/config/env')).env;
}

const firebase = { AUTH_MODE: 'firebase', FIREBASE_PROJECT_ID: 'p', FIREBASE_CLIENT_EMAIL: 'e@p.iam', FIREBASE_PRIVATE_KEY: 'k' };

describe('CLIENT_ORIGIN', () => {
  it('strips trailing slashes and supports several origins', async () => {
    const env = await load({ ...firebase, NODE_ENV: 'test', CLIENT_ORIGIN: 'https://a.example.com/, http://localhost:4200' });
    expect(env.clientOrigins).toEqual(['https://a.example.com', 'http://localhost:4200']);
  });

  it.each(['https://a.example.com/app', 'a.example.com', 'ftp://a.example.com'])('rejects %s with a helpful message', async (value) => {
    await expect(load({ ...firebase, NODE_ENV: 'test', CLIENT_ORIGIN: value })).rejects.toThrow(/CLIENT_ORIGIN/);
  });
});

describe('production guards', () => {
  it('refuses the development login', async () => {
    await expect(load({ NODE_ENV: 'production', AUTH_MODE: 'development', CLIENT_ORIGIN: 'https://a.example.com' })).rejects.toThrow(/AUTH_MODE/);
  });

  it('requires CLIENT_ORIGIN to be set explicitly', async () => {
    await expect(load({ ...firebase, NODE_ENV: 'production' })).rejects.toThrow(/CLIENT_ORIGIN must be set/);
  });

  it('trusts one proxy hop by default in production only', async () => {
    expect((await load({ ...firebase, NODE_ENV: 'production', CLIENT_ORIGIN: 'https://a.example.com' })).trustProxy).toBe(1);
    expect((await load({ ...firebase, NODE_ENV: 'test' })).trustProxy).toBe(0);
    expect((await load({ ...firebase, NODE_ENV: 'test', TRUST_PROXY: '2' })).trustProxy).toBe(2);
  });
});

describe('firebase private key', () => {
  it('turns escaped newlines into real ones and drops wrapping quotes', async () => {
    const env = await load({ ...firebase, NODE_ENV: 'test', FIREBASE_PRIVATE_KEY: '"-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n"' });
    expect(env.firebase.privateKey).toBe('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n');
  });

  it('is required in firebase mode', async () => {
    await expect(load({ AUTH_MODE: 'firebase', NODE_ENV: 'test' })).rejects.toThrow(/FIREBASE_PROJECT_ID/);
  });
});

/**
 * Post-deploy smoke test: checks a running API from the outside, the way the browser and the platform see it.
 *
 *   npm run smoke -- https://your-api.onrender.com https://your-app.netlify.app
 *
 * The second argument is the UI origin that should be allowed by CORS. Exits non-zero if anything fails.
 */
import { io } from 'socket.io-client';

const [apiArg, originArg] = process.argv.slice(2);
if (!apiArg) {
  console.error('Usage: npm run smoke -- <api-url> [ui-origin]');
  process.exit(2);
}
const api = apiArg.replace(/\/+$/, '');
const origin = originArg?.replace(/\/+$/, '');

type Result = { name: string; ok: boolean; detail: string; warn?: boolean };
const results: Result[] = [];
async function check(name: string, fn: () => Promise<string>, opts: { warnOnly?: boolean } = {}) {
  try {
    results.push({ name, ok: true, detail: await fn() });
  } catch (error) {
    results.push({ name, ok: false, warn: opts.warnOnly, detail: error instanceof Error ? error.message : String(error) });
  }
}
const expect = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

async function main() {
  // A free-tier service may be asleep; the first request wakes it, which can take a minute.
  await check('liveness: GET /health', async () => {
    const started = Date.now();
    const res = await fetch(`${api}/health`, { signal: AbortSignal.timeout(90_000) });
    expect(res.status === 200, `status ${res.status}`);
    expect(((await res.json()) as { status?: string }).status === 'ok', 'unexpected body');
    return `ok in ${Date.now() - started} ms`;
  });

  await check('readiness: GET /ready (database connected)', async () => {
    const res = await fetch(`${api}/ready`);
    expect(res.status === 200, `status ${res.status}; check MONGODB_URI and the Atlas network access list`);
    return 'database up';
  });

  await check('protected route rejects anonymous callers (401)', async () => {
    const res = await fetch(`${api}/api/v1/me`);
    expect(res.status === 401, `expected 401, got ${res.status} (is AUTH_MODE=firebase?)`);
    return '401 as expected';
  });

  await check('rejects a forged token (401)', async () => {
    const res = await fetch(`${api}/api/v1/me`, { headers: { authorization: 'Bearer not.a.real.token' } });
    expect(res.status === 401, `expected 401, got ${res.status}`);
    return '401 as expected';
  });

  await check('unknown route returns JSON 404', async () => {
    const res = await fetch(`${api}/api/v1/nope`);
    expect(res.status === 404 && (await res.json() as { success?: boolean }).success === false, `status ${res.status}`);
    return '404 JSON';
  });

  await check('security headers are set', async () => {
    const res = await fetch(`${api}/health`);
    for (const h of ['x-content-type-options', 'strict-transport-security']) expect(res.headers.get(h), `missing ${h}`);
    expect(!res.headers.get('x-powered-by'), 'x-powered-by should be hidden');
    return 'helmet headers present';
  }, { warnOnly: api.startsWith('http://') });

  if (origin) {
    await check(`CORS allows ${origin}`, async () => {
      const res = await fetch(`${api}/api/v1/me`, {
        method: 'OPTIONS',
        headers: { origin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' }
      });
      expect(res.headers.get('access-control-allow-origin') === origin, `got "${res.headers.get('access-control-allow-origin')}"; set CLIENT_ORIGIN to exactly ${origin} (no trailing slash)`);
      return 'origin allowed';
    });
    await check('CORS does not allow other origins', async () => {
      const res = await fetch(`${api}/api/v1/me`, { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
      expect(!res.headers.get('access-control-allow-origin'), 'an unlisted origin was allowed');
      return 'blocked';
    });
  }

  await check('WebSocket handshake without a token is refused', async () => {
    const socket = io(api, { transports: ['websocket'], reconnection: false, timeout: 90_000, ...(origin ? { extraHeaders: { origin } } : {}) });
    try {
      const message = await new Promise<string>((resolve, reject) => {
        socket.once('connect', () => reject(new Error('connected without credentials')));
        socket.once('connect_error', (e) => resolve(e.message));
      });
      expect(message === 'UNAUTHORIZED', `unexpected error "${message}"`);
      return 'UNAUTHORIZED as expected (WebSocket transport reachable)';
    } finally {
      socket.close();
    }
  });

  await check('Swagger UI is served at /api-docs', async () => {
    const res = await fetch(`${api}/api-docs/`);
    expect(res.status === 200, `status ${res.status} (ENABLE_DOCS=false?)`);
    return 'available';
  }, { warnOnly: true });
}

main().then(() => {
  let failed = 0;
  for (const r of results) {
    const mark = r.ok ? 'PASS' : r.warn ? 'WARN' : 'FAIL';
    if (!r.ok && !r.warn) failed++;
    console.log(`${mark}  ${r.name}\n      ${r.detail}`);
  }
  console.log(failed ? `\n${failed} check(s) failed.` : '\nAll required checks passed.');
  process.exit(failed ? 1 : 0);
});

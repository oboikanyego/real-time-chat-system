/**
 * Build-time configuration for the Angular app.
 *
 * Reads CHAT_API_URL, CHAT_SOCKET_URL and FIREBASE_* from the environment and writes:
 *   - src/environments/environment.ts           the values compiled into the bundle
 *   - public/_headers                           Netlify response headers (incl. Content-Security-Policy)
 *   - generated/security-headers.conf           the same headers for the nginx image
 *
 * `--require-firebase` (used by the Netlify build) fails the build when the configuration is incomplete, because a
 * bundle without Firebase settings silently falls back to the development login, which a real API rejects.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const requireFirebase = process.argv.includes('--require-firebase');
const env = process.env;
const fail = (message) => {
  console.error(`[ui] ${message}`);
  process.exit(1);
};

const apiUrl = (env.CHAT_API_URL || 'http://localhost:3000').replace(/\/+$/, '');
const socketUrl = (env.CHAT_SOCKET_URL || apiUrl).replace(/\/+$/, '');
const firebase = {
  apiKey: env.FIREBASE_API_KEY || '',
  authDomain: env.FIREBASE_AUTH_DOMAIN || '',
  projectId: env.FIREBASE_PROJECT_ID || '',
  storageBucket: env.FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID || '',
  appId: env.FIREBASE_APP_ID || ''
};

const origin = (name, value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    return fail(`${name} must be a full URL such as https://your-api.onrender.com (got "${value}")`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) fail(`${name} must start with http:// or https:// (got "${value}")`);
  return url;
};
const api = origin('CHAT_API_URL', apiUrl);
const socket = origin('CHAT_SOCKET_URL', socketUrl);

if (requireFirebase) {
  const missing = ['apiKey', 'authDomain', 'projectId', 'appId'].filter((k) => !firebase[k]);
  if (missing.length) {
    fail(`missing Firebase settings: ${missing.map((k) => `FIREBASE_${k.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`).join(', ')}. Set them in the Netlify site settings.`);
  }
  if (!env.CHAT_API_URL) fail('CHAT_API_URL is not set. Set it to your deployed API URL.');
  if (api.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(api.hostname)) fail(`CHAT_API_URL must be an https URL for a production build (got "${apiUrl}")`);
}

// ---- environment.ts -------------------------------------------------------------------------------------------
const q = (value) => JSON.stringify(value);
writeFileSync(
  'src/environments/environment.ts',
  `export const environment = {
  production: true,
  apiUrl: ${q(apiUrl)},
  socketUrl: ${q(socketUrl)},
  firebase: {
    apiKey: ${q(firebase.apiKey)},
    authDomain: ${q(firebase.authDomain)},
    projectId: ${q(firebase.projectId)},
    storageBucket: ${q(firebase.storageBucket)},
    messagingSenderId: ${q(firebase.messagingSenderId)},
    appId: ${q(firebase.appId)}
  }
};\n`
);

// ---- Content-Security-Policy ----------------------------------------------------------------------------------
const wsOf = (url) => `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`;
const connect = new Set(["'self'", api.origin, wsOf(api), socket.origin, wsOf(socket)]);
const frames = new Set();
const scripts = new Set(["'self'"]);
const images = new Set(["'self'", 'data:']);

if (firebase.apiKey) {
  for (const host of ['identitytoolkit.googleapis.com', 'securetoken.googleapis.com', 'www.googleapis.com', 'firebaseinstallations.googleapis.com']) connect.add(`https://${host}`);
  if (firebase.authDomain) frames.add(`https://${firebase.authDomain}`);
  frames.add('https://accounts.google.com');
  scripts.add('https://apis.google.com'); // loaded by the Firebase Auth SDK for the Google sign-in popup
  images.add('https://*.googleusercontent.com'); // Google profile photos
}

const csp = [
  "default-src 'self'",
  `script-src ${[...scripts].join(' ')}`,
  "style-src 'self' 'unsafe-inline'", // Angular inlines critical CSS
  `img-src ${[...images].join(' ')}`,
  "font-src 'self'",
  `connect-src ${[...connect].join(' ')}`,
  `frame-src ${frames.size ? [...frames].join(' ') : "'none'"}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

const headers = {
  'Content-Security-Policy': csp,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-Frame-Options': 'DENY'
};

// Netlify: security headers everywhere, long caching for fingerprinted assets, never cache the app shell.
const netlify = `/*
${Object.entries(headers).map(([k, v]) => `  ${k}: ${v}`).join('\n')}

/*.js
  Cache-Control: public, max-age=31536000, immutable
/*.css
  Cache-Control: public, max-age=31536000, immutable
/index.html
  Cache-Control: no-cache
/theme-init.js
  Cache-Control: no-cache
`;
writeFileSync('public/_headers', netlify);

// nginx: included from every location that sets its own headers (add_header is not inherited across levels).
mkdirSync('generated', { recursive: true });
writeFileSync(
  'generated/security-headers.conf',
  Object.entries(headers).map(([k, v]) => `add_header ${k} ${q(v)} always;`).join('\n') + '\n'
);

console.log(`[ui] environment.ts, _headers and security-headers.conf generated (api: ${api.origin}, firebase: ${firebase.apiKey ? 'configured' : 'not configured'})`);

import { writeFileSync } from 'node:fs';

const q = (value = '') => JSON.stringify(value);
const content = `export const environment = {
  production: true,
  apiUrl: ${q(process.env.CHAT_API_URL || 'http://localhost:3000')},
  socketUrl: ${q(process.env.CHAT_SOCKET_URL || process.env.CHAT_API_URL || 'http://localhost:3000')},
  firebase: {
    apiKey: ${q(process.env.FIREBASE_API_KEY)},
    authDomain: ${q(process.env.FIREBASE_AUTH_DOMAIN)},
    projectId: ${q(process.env.FIREBASE_PROJECT_ID)},
    storageBucket: ${q(process.env.FIREBASE_STORAGE_BUCKET)},
    messagingSenderId: ${q(process.env.FIREBASE_MESSAGING_SENDER_ID)},
    appId: ${q(process.env.FIREBASE_APP_ID)}
  }
};\n`;

writeFileSync('src/environments/environment.ts', content);
console.log('[ui] environment.ts generated');

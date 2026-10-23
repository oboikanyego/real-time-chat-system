# Deployment guide

This takes the app from a clone of the repository to a live deployment:

| Part | Where | Why |
| --- | --- | --- |
| Angular UI | Netlify | Static hosting and a CDN; builds from this repo |
| Node API + Socket.IO | Render (Docker web service) | Long-lived process, which WebSockets need |
| Database | MongoDB Atlas | Managed MongoDB with a free tier |
| Sign-in | Firebase Authentication | Email/password and Google; the API verifies the ID tokens |

Everything below can be done on free tiers. Read [Free-tier behaviour](#free-tier-behaviour) first so the cold starts do
not surprise you.

## The order matters

The UI needs the API's URL, the API needs the UI's URL (for CORS), and Firebase needs the UI's domain. Follow the steps in
this order and no step is blocked:

1. MongoDB Atlas (get a connection string)
2. Firebase (get the web config and a service-account key)
3. Render: deploy the API with a temporary `CLIENT_ORIGIN`
4. Netlify: deploy the UI with the API's URL
5. Go back and set the real `CLIENT_ORIGIN` on Render and add the Netlify domain to Firebase
6. Smoke test

## 1. MongoDB Atlas

1. Create a free **M0** cluster at <https://cloud.mongodb.com>.
2. **Database Access** > add a database user with a long random password and the *Read and write to any database* role.
3. **Network Access** > add an IP access list entry. Render's free tier has no fixed outbound address, so you will need
   `0.0.0.0/0` ("allow from anywhere"). This is acceptable only because the database still requires the password, so keep
   it long and random. Paid Render plans can use static outbound IPs instead.
4. **Connect** > *Drivers* and copy the connection string. Put the database name before the `?`, and URL-encode any
   special characters in the password:

   ```text
   mongodb+srv://chatuser:PASSWORD@cluster0.xxxxx.mongodb.net/realtime_chat?retryWrites=true&w=majority
   ```

   This is `MONGODB_URI`. Indexes are created automatically the first time the API starts.

M0 clusters have no automatic backups. Take an export before you put anything you care about in it.

## 2. Firebase

1. Create a project at <https://console.firebase.google.com>.
2. **Build > Authentication > Get started**, then **Sign-in method**: enable **Email/Password** and **Google**.
3. **Project settings > General > Your apps > Add app (Web)**. Copy the `firebaseConfig` values. They become the UI's
   `FIREBASE_*` variables. They are public identifiers that ship inside the JavaScript bundle, not secrets.
4. **Project settings > Service accounts > Generate new private key**. From the downloaded JSON you need three values for
   the API: `project_id`, `client_email` and `private_key`. This key **is** a secret. Never commit it. If it leaks, delete
   it in the console and generate a new one.
5. Authorised domains come later, in step 5.

## 3. Render (API)

1. In Render choose **New > Blueprint**, connect this repository and select `render.yaml`. It creates a Docker web service
   named `real-time-chat-api`, with health check `/health` and deploys gated on CI.
2. Fill in the variables Render asks for (marked `sync: false` in the Blueprint):

   | Variable | Value |
   | --- | --- |
   | `MONGODB_URI` | the Atlas string from step 1 |
   | `CLIENT_ORIGIN` | `http://localhost:4200` for now (you will change it in step 5) |
   | `FIREBASE_PROJECT_ID` | `project_id` from the key file |
   | `FIREBASE_CLIENT_EMAIL` | `client_email` from the key file |
   | `FIREBASE_PRIVATE_KEY` | `private_key` from the key file, pasted as is. Literal `\n` sequences and surrounding quotes are fine |

   `NODE_ENV=production`, `AUTH_MODE=firebase` and `TRUST_PROXY=1` are already set by the Blueprint.
3. Wait for the deploy. Check `https://<your-service>.onrender.com/ready`. It should return `{"status":"ready"}`.

The API **refuses to start** (and the deploy fails with the reason in the logs) if `CLIENT_ORIGIN` is missing or malformed,
if the Firebase key cannot be parsed, or if `AUTH_MODE` is not `firebase` in production. A failed deploy in Render keeps
serving the previous version.

## 4. Netlify (UI)

1. **Add new site > Import an existing project**, pick this repository. `netlify.toml` already sets the base directory,
   build command and publish directory.
2. In **Site configuration > Environment variables** set:

   | Variable | Value |
   | --- | --- |
   | `CHAT_API_URL` | `https://<your-service>.onrender.com` (https, no trailing slash) |
   | `CHAT_SOCKET_URL` | optional; same as `CHAT_API_URL` if you leave it out |
   | `FIREBASE_API_KEY` | web config `apiKey` |
   | `FIREBASE_AUTH_DOMAIN` | `<project>.firebaseapp.com` |
   | `FIREBASE_PROJECT_ID` | web config `projectId` |
   | `FIREBASE_STORAGE_BUCKET` | web config `storageBucket` |
   | `FIREBASE_MESSAGING_SENDER_ID` | web config `messagingSenderId` |
   | `FIREBASE_APP_ID` | web config `appId` |

3. Deploy. The build **fails with a message naming the missing variable** rather than publishing a site that would show the
   development login. It also generates the Content-Security-Policy from `CHAT_API_URL` and your Firebase domain.
4. Note the site URL, for example `https://your-app.netlify.app`.

## 5. Connect the pieces

1. **Render > Environment**: set `CLIENT_ORIGIN` to the exact Netlify URL (`https://your-app.netlify.app`, no trailing
   slash). Several origins can be comma-separated (for example a custom domain as well). Save to redeploy.
2. **Firebase > Authentication > Settings > Authorised domains**: add the Netlify domain (and any custom domain).
   Without this, Google sign-in fails with `auth/unauthorized-domain`.

## 6. Smoke test

From a checkout of the repository:

```bash
cd chat-api
npm install
npm run smoke -- https://<your-service>.onrender.com https://your-app.netlify.app
```

It checks liveness, database readiness, that anonymous and forged-token requests get 401, that CORS allows your UI origin
and nobody else, that the WebSocket endpoint is reachable and refuses unauthenticated connections, and the security
headers. Every `FAIL` line says what to look at. The first request may take up to a minute on the free tier.

Then do a human check, which no script replaces:

1. Open the site in two different browsers (or one normal and one private window) and register two accounts.
2. In one, open **People**, find the other, send a message. It should appear instantly in the other, with a badge.
3. Open it in the other: the first should show blue double ticks. Type in one to see "typing…" in the other.
4. Close one browser: the other shows "Last seen just now" after about five seconds.

## Environment variable reference

### API (`chat-api`)

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | | `development` | `production` turns on the safety checks below |
| `PORT` | | `3000` | Render injects its own |
| `MONGODB_URI` | yes | | Include the database name |
| `CLIENT_ORIGIN` | in production | `http://localhost:4200` | Comma-separated origins; scheme + host (+ port) only. A trailing slash is stripped; a path is rejected |
| `AUTH_MODE` | | `firebase` | `development` is the header-based dev login and is **refused when `NODE_ENV=production`** |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | in firebase mode | | Service account. Checked at startup |
| `TRUST_PROXY` | | `1` in production, else `0` | Number of proxies in front of the API |
| `LOG_LEVEL` | | `info` | `silent` under test |
| `ENABLE_DOCS` | | `true` | Swagger UI at `/api-docs` |
| `PRESENCE_GRACE_MS` | | `5000` | Delay before a user is shown offline |

### UI (build-time)

| Variable | Notes |
| --- | --- |
| `CHAT_API_URL`, `CHAT_SOCKET_URL` | Compiled into the bundle, so changing them needs a rebuild |
| `FIREBASE_*` | The web config. Empty means the development login (local Docker only) |

## Free-tier behaviour

- **Render free instances sleep after about 15 minutes without traffic.** The next request wakes them, which takes 30 to 60
  seconds. The sign-in screen tells the user this if it is taking a while, and open tabs reconnect on their own. Upgrade the
  plan, or ping `/health` from an uptime monitor, if you do not want the delay.
- **Presence and typing state live in the API process's memory.** That is correct for one instance (the default). If you
  scale to several instances you need a shared store; the design notes in `docs/TECHNICAL_DESIGN.md` describe what to add.
- **A restart disconnects everyone briefly.** Clients reconnect and catch up on missed messages and receipts automatically.
- Atlas M0 has 512 MB of storage and no backups.

## Operations

- **Logs:** Render's log view shows one JSON object per line. Search for `"level":50` (errors). Authorization headers and
  query strings are never logged.
- **Rollback:** Render and Netlify both keep previous deploys; use their *Rollback* / *Publish deploy* buttons.
- **Rotating the Firebase key:** generate a new key, update the three Render variables, then delete the old key in Firebase.
- **Custom domain:** add it in Netlify and add it to `CLIENT_ORIGIN` (comma-separated) and to Firebase authorised domains.
- **Deploy gating:** `render.yaml` uses `autoDeployTrigger: checksPass`, so Render deploys a commit only after the GitHub
  Actions checks pass.

## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| Browser console: *blocked by CORS policy* | `CLIENT_ORIGIN` does not exactly match the site's origin. Check scheme, subdomain, no trailing slash. Run the smoke test with the UI URL |
| Sign-in page shows "Firebase is not configured" on the live site | The UI was built without the `FIREBASE_*` variables. The Netlify build is meant to refuse this; check you deployed the `build:netlify` command |
| Every request returns 401 after signing in | The API's `FIREBASE_PROJECT_ID` is a different project from the UI's. Both must be the same project |
| Google sign-in: `auth/unauthorized-domain` | Add the site's domain under Firebase > Authentication > Settings > Authorised domains |
| Google sign-in popup does nothing or the console shows a *Content Security Policy* error | The policy is generated in `chat-ui/scripts/write-env.mjs`. Add the blocked host named in the console message to the matching directive, then redeploy |
| API deploy fails immediately | Read the first lines of the Render log; the message names the problem (bad `CLIENT_ORIGIN`, unreadable Firebase key, wrong `AUTH_MODE`) |
| API starts but `/ready` is 503 / "Server selection timed out" | Wrong `MONGODB_URI`, or Atlas Network Access does not allow Render (step 1.3) |
| Messages arrive only after a refresh | The WebSocket is not connecting. Check `CHAT_SOCKET_URL`, that `CLIENT_ORIGIN` matches, and the "connected" indicator in the top bar |
| Rate-limit errors for everyone at once | `TRUST_PROXY` is `0` behind a proxy, so all users share one address. It defaults to `1` in production |
| Docker build: *toomanyrequests* | Docker Hub rate limit. Pass a mirror, for example `NODE_IMAGE=mirror.gcr.io/library/node:22-alpine docker compose build` |

## Security checklist

- No secret is in the repository: `.env` files are ignored, and the Firebase service-account key only ever lives in Render's
  environment.
- The development login cannot be enabled in production; the API refuses to boot.
- Tokens are verified server-side on every REST call and on every WebSocket handshake; users can only read and send in
  conversations they belong to, and other people's conversations return 404 rather than 403.
- CORS is limited to the origins you list; requests are rate limited (240 per minute per client, 20 sends per 10 seconds per
  socket); request bodies are limited to 256 kB; messages are 2000 characters at most.
- The UI sends a Content-Security-Policy that allows scripts only from itself (plus Google's sign-in script), and forbids
  framing, plugins and inline scripts.
- Messages are stored and transported as plain text (TLS protects them in transit; they are not end-to-end encrypted) and are
  rendered as text, never as HTML.

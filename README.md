# Real-Time Chat System

A portfolio-grade real-time chat platform using Angular, Node.js/Express, MongoDB, Firebase Authentication, and Socket.IO.

## Repository layout

```text
real-time-chat-system/
├── chat-ui/              # Angular frontend (Netlify, or nginx in Docker)
├── chat-api/             # Node.js + Express + Socket.IO API (Render, or Docker)
├── docs/                 # BRD, technical design and DEPLOYMENT.md
├── docker-compose.yml    # Local full stack: MongoDB + API + UI
├── .github/workflows/    # CI: tests, real-MongoDB integration tests, Docker build
├── netlify.toml          # Netlify build configuration
└── render.yaml           # Render Blueprint for the API
```

## Run it locally

### With Docker (nothing else to install)

```bash
docker compose up --build
```

Then open <http://localhost:4200>. With no Firebase configured you get a username-only development login, so open two
browser windows, sign in as two different names and chat. Also available: API health at <http://localhost:3000/health>,
Swagger at <http://localhost:3000/api-docs>. All ports are bound to `127.0.0.1` because the development login trusts a
header and must not be reachable from other machines. To use real Firebase locally, copy `.env.example` to `.env`.

### Without Docker

```bash
# terminal 1: needs a MongoDB on localhost:27017 (e.g. `docker run -p 27017:27017 mongo:7`)
cd chat-api && cp .env.example .env && npm install && npm run dev

# terminal 2
cd chat-ui && npm install && npm start      # http://localhost:4200
```

## Deploying

The UI goes to Netlify, the API to Render (Docker), the database to MongoDB Atlas, and sign-in is Firebase Authentication.
**[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** is the step-by-step guide (accounts, environment variables, the order to do
things in, a post-deploy smoke test and troubleshooting). In short:

1. MongoDB Atlas: create a free cluster and a database user, and allow network access.
2. Firebase: enable Email/Password and Google sign-in, copy the web config and generate a service-account key.
3. Render: create a Blueprint from `render.yaml`, then set `MONGODB_URI`, `CLIENT_ORIGIN` and the `FIREBASE_*` secrets.
4. Netlify: import the repo and set `CHAT_API_URL` and the `FIREBASE_*` web config. The build fails with a clear message if any is missing.
5. Run `npm run smoke -- <api-url> <ui-url>` in `chat-api` to check the deployment from the outside.

## Operations

- **Health:** `GET /health` (liveness, used by Render) and `GET /ready` (also checks the database).
- **Logs:** one JSON line per event (pino), with authorization headers and query strings never logged.
- **Safe by default in production:** the API refuses to start with the development login, without an explicit `CLIENT_ORIGIN`, or with a malformed Firebase key; it trusts exactly one proxy hop so rate limiting sees real client addresses; and it shuts down gracefully on SIGTERM.
- **Browser security:** the UI is served with a Content-Security-Policy generated from your API and Firebase settings, plus the usual headers (nosniff, frame denial, referrer and permissions policies).
- **CI:** every push runs typecheck, unit tests, the UI build, integration tests against a real MongoDB, and a Docker Compose smoke test. Render deploys only after these checks pass.

## Authentication

- **UI:** `/login` and `/register` (email/password and Google) via Firebase Auth; `/chat` is guarded and shows the signed-in profile and Socket.IO connection state. Sign out clears the session.
- **API:** `GET /api/v1/me` verifies the Firebase ID token, creates the MongoDB profile on first sign-in and returns it; `PATCH /api/v1/me` updates the display name. The Socket.IO handshake uses the same token (`auth.token`).
- **Without Firebase:** with `AUTH_MODE=development` on the API (never honoured when `NODE_ENV=production`) and an empty Firebase config in the UI, the login page shows a username-only dev sign-in. The username is sent as `X-Dev-User` (and `auth.devUser` on the socket), so several local users can be simulated in separate browser sessions.
- **With Firebase:** enable Email/Password and Google providers in the Firebase console, put the web app config in `chat-ui/src/environments/environment.ts` (or the Netlify variables), and set `AUTH_MODE=firebase` plus the service-account variables on the API.

## User directory

- **API:** `GET /api/v1/users?q=&page=&limit=` lists other users (never the caller), sorted by name and paginated (`limit` up to 50, `meta.hasMore`). Every word of `q` must prefix-match a word of the display name (`gra hop` finds Grace Hopper), served from an indexed `searchTokens` field. A `q` containing `@` is an exact email lookup. Responses expose only `id`, `displayName` and `photoURL`, never email or Firebase UID. `GET /api/v1/users/:id` returns one entry.
- **UI:** the `/chat` page has a "People" panel with debounced search, loading/empty/error states, retry and "Load more". Picking a user emits an event that the conversations phase will use.

## Conversations

- **API:** `POST /api/v1/conversations {userId}` opens the direct conversation with another user. It is idempotent (201 when created, 200 when it already exists) and safe under concurrent requests, via a unique key built from the two sorted participant ids. `GET /api/v1/conversations` lists the caller's conversations, most recent activity first, paginated. `GET /api/v1/conversations/:id` returns one; non-participants get a 404, so ids cannot be probed. You cannot open a conversation with yourself.
- **Visibility:** a conversation appears in someone's list once they opened it or it has messages, so being "started" by another user does not litter your list with empty chats.
- **UI:** `/chat` is now a two-pane layout: Chats and People tabs on the left, the open conversation (`/chat/:id`, deep-linkable) on the right. Picking a person in People opens their conversation. On narrow screens only one pane shows at a time.

## Messaging

- **Sending:** the UI emits `message:send {conversationId, clientMessageId, text}` over the socket and gets an acknowledgement, `{ok: true, message, duplicate}` or `{ok: false, error: {code, message}}`. If the socket is down or no acknowledgement arrives within 8 s, it falls back to `POST /api/v1/conversations/:id/messages`. Both paths share one service, so a message is stored once: `clientMessageId` is unique per sender, and a retry returns the stored message instead of a second copy.
- **Receiving:** after storing, the API pushes `message:new` and `conversation:updated` (each recipient's own view, with the other person inlined) to every connected tab of both participants. A new conversation therefore appears in the recipient's list the moment the first message arrives.
- **History:** `GET /api/v1/conversations/:id/messages?before=<messageId>&limit=` returns pages newest-first by message id, delivered oldest-first; the UI loads the latest 30 and "Load earlier messages" pages backwards.
- **Safety:** the sender is always the authenticated user, never a payload field; text is trimmed, 1-2000 characters, and rendered as plain text; only participants can read or send (others get 404); each socket is limited to 20 sends per 10 s.
- **Resilience:** unconfirmed messages show "Sending…" or "Failed" with Retry; after a reconnect the UI refetches the conversation list and any open or previously loaded conversations to catch up on missed messages.

## Presence, receipts and typing

- **Presence:** the chat header and conversation list show who is online (green dot) or when they were last seen. A user is online while any tab has a socket; going offline waits 5 s so reloading does not flicker, then records "last seen". Presence is only shared between people who have exchanged a message.
- **Receipts:** your messages show ✓ sent, ✓✓ delivered (the other person has a live connection, or connected since) and blue ✓✓ read. Receipts are stored as per-user cursors on the conversation, so marking a long history read is a single write.
- **Unread:** conversations show an unread badge (capped at 99+) and the browser tab title shows the total. A conversation is only marked read while it is open **and** the page is visible and focused; a message that arrives in an unfocused tab stays unread until you come back.
- **Typing:** "typing…" appears in the header and the list while the other person types; it is throttled on the sender's side and expires on its own if the sender goes quiet.
- **Limits:** presence state lives in the memory of one API instance (fine for the single Render service; multiple instances would need Redis).

## UI polish

- **Theming:** all colours are CSS variables in `chat-ui/src/styles.css`. Light and dark themes follow the system setting by default; the sun/moon/monitor button in the top bar cycles system, light and dark and remembers the choice. The saved theme is applied before first paint, so there is no flash.
- **Accessibility:** the app has landmarks, a single `h1`, a "Skip to conversation" link, properly wired tabs (arrow keys, Home and End), a live message log, labelled form fields with associated errors, visible focus rings, reduced-motion support and 44 px touch targets on touch screens. The login, chat, dark-mode and profile screens pass an axe-core scan (WCAG 2 A/AA plus best practices) with no violations.
- **Conversation view:** day separators ("Today", "Yesterday", weekday), runs of messages from one person grouped together, a "N new messages" pill when you are scrolled up, skeleton loaders, friendly empty states, and a banner when the connection drops ("You're offline", "Reconnecting…", or a prompt to sign in again if the session expired).
- **Profile:** click your name in the top bar to change your display name (`PATCH /api/v1/me`).
- **Mobile:** uses dynamic viewport height and safe-area insets, shows one pane at a time, and does not auto-focus the composer on touch screens (that would open the keyboard).
- **Other:** coloured avatars, last-message time in the list, route-based page titles, favicon and theme-color.

## Tests

```bash
cd chat-api
npm test                  # 113 unit tests; the database is mocked
npm run test:integration  # 19 end-to-end checks against a running API and a real MongoDB (see below)
npm run smoke -- <api-url> [ui-origin]   # post-deploy checks against any running API
```

The integration tests need a MongoDB and the API running in development mode, for example:

```bash
docker run -d -p 27017:27017 mongo:7
cd chat-api && MONGODB_URI=mongodb://localhost:27017/chat_it AUTH_MODE=development PRESENCE_GRACE_MS=400 npm run dev &
npm run test:integration
```

## Roadmap

All planned phases are complete: foundation, authentication, user directory, conversations, messaging, presence and read receipts, UI polish, deployment.

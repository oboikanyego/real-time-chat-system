# Real-Time Chat System

A portfolio-grade real-time chat platform using Angular, Node.js/Express, MongoDB, Firebase Authentication, and Socket.IO.

## Repository layout

```text
real-time-chat-system/
├── chat-ui/              # Angular frontend (Netlify)
├── chat-api/             # Node.js + Express + Socket.IO API (Render Docker service)
├── docs/                 # BRD and technical design source documents
├── docker-compose.yml    # Local full-stack environment
├── netlify.toml          # Netlify build configuration
└── render.yaml           # Render Blueprint for the API
```

## Local development with Docker

1. Copy `chat-api/.env.example` to `chat-api/.env` if you want to provide Firebase credentials.
2. Run:

```bash
docker compose up --build
```

Then open:

- UI: `http://localhost:4200`
- API health: `http://localhost:3000/health`
- Swagger: `http://localhost:3000/api-docs`
- MongoDB: `mongodb://localhost:27017`

The initial foundation can boot without Firebase credentials, but authenticated chat features require a Firebase project before implementation of the authentication phase.

## Local development without Docker

### API

```bash
cd chat-api
npm install
npm run dev
```

### UI

```bash
cd chat-ui
npm install
npm start
```

## Deployment

### Netlify - Angular UI

The root `netlify.toml` sets `chat-ui` as the build base. Configure these Netlify environment variables before production deploy:

- `CHAT_API_URL=https://<your-render-service>.onrender.com`
- `CHAT_SOCKET_URL=https://<your-render-service>.onrender.com`
- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_APP_ID`

### Render - Node.js API

`render.yaml` configures `chat-api` as a Docker web service. Set the secret environment variables in Render:

- `MONGODB_URI` (MongoDB Atlas connection string)
- `CLIENT_ORIGIN` (your Netlify production URL)
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

The API binds to `0.0.0.0` and uses Render's `PORT` variable.

## Documentation

- `docs/BRD.md` - Business Requirements Document source
- `docs/TECHNICAL_DESIGN.md` - system architecture, data model, REST API and Socket.IO contracts
- DOCX versions are included in the project package and supplied separately.

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

## Tests

```bash
cd chat-api && npm test
```

## Roadmap

Done: foundation, authentication, user directory, conversations. Next: messaging, presence/read receipts, UI polish, deployment.

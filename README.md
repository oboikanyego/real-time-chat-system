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

## Tests

```bash
cd chat-api && npm test
```

## Roadmap

Done: foundation, authentication. Next: user directory, conversations, messaging, presence/read receipts, UI polish, deployment.

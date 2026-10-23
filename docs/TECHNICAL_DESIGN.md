# Technical Design Document - Real-Time Chat System

## Architecture
Angular SPA on Netlify communicates with a Node.js/Express/Socket.IO service on Render. Firebase Authentication issues client ID tokens; the API verifies them using Firebase Admin. MongoDB Atlas stores application profiles, conversations and messages. Docker Compose runs UI + API + MongoDB locally.

## MongoDB model
- `users`: application profile keyed by unique `firebaseUid`.
- `conversations`: type, participant IDs, deterministic direct conversation key, last message metadata and timestamps.
- `messages`: conversation ID, sender ID, unique `clientMessageId`, type/content, per-recipient delivery/read receipts and timestamps.

## REST contract
Health, current user/profile, user search, conversation list/create/read, paginated messages, REST message fallback and read updates. All protected endpoints use `Authorization: Bearer <Firebase ID token>`.

## Socket.IO contract
Handshake auth token; authenticated personal room; authorized conversation rooms; `message:send`, `message:new`, `message:delivered`, `message:read`, `message:status`, `typing:start`, `typing:stop`, `typing:update`, `presence:update`, `conversation:updated`, and `system:error`.

### Implemented messaging contract
- `message:send` (client to server): `{conversationId, clientMessageId, text}` with an acknowledgement callback returning `{ok: true, message, duplicate}` or `{ok: false, error: {code, message}}`. Error codes: `VALIDATION_ERROR`, `CONVERSATION_NOT_FOUND`, `RATE_LIMITED`, `CLIENT_MESSAGE_ID_REUSED`, `INTERNAL_ERROR`.
- `message:new` `{message}` and `conversation:updated` `{conversation}` (server to client) go to each participant's personal room `user:<profileId>`.
- Messages are unique on `(senderId, clientMessageId)` and indexed on `(conversationId, _id desc)` for history paging. Per-recipient delivery/read receipts and unread counts are not implemented yet.

## Deployment
Netlify builds `chat-ui`. Render builds `chat-api/Dockerfile` using `render.yaml`. Production database is MongoDB Atlas. Local `docker compose up --build` runs MongoDB, API and Nginx-hosted Angular UI.

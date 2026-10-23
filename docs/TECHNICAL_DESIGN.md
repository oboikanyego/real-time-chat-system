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

### Implemented real-time contract
Client to server (all acknowledged except typing):
- `message:send` `{conversationId, clientMessageId, text}` returns `{ok: true, message, duplicate}` or `{ok: false, error: {code, message}}`.
- `message:read` `{conversationId, messageId}` marks the conversation read up to that message; returns `{ok: true, changed}`.
- `typing:start` / `typing:stop` `{conversationId}`: relayed to the other participant; dropped silently if invalid, unauthorized, rate-limited or the conversation has no messages yet.

Server to client, sent to each participant's personal room `user:<profileId>`:
- `message:new` `{message}`.
- `conversation:updated` `{conversation}`: the recipient's own view (inlined participant with presence, `unreadCount`, `peerReceipts`, last message).
- `receipt:update` `{conversationId, userId, deliveredUpTo, readUpTo}`: `userId` is the person who received or read.
- `presence:update` `{userId, online, lastSeenAt}`: only to people who exchanged at least one message with that user.
- `typing:update` `{conversationId, userId, typing}`.

Error codes: `VALIDATION_ERROR`, `CONVERSATION_NOT_FOUND`, `MESSAGE_NOT_FOUND`, `RATE_LIMITED`, `CLIENT_MESSAGE_ID_REUSED`, `INTERNAL_ERROR`.

### Receipts and unread counts
Each conversation stores per-user cursors, `cursors[userId] = {deliveredUpTo, readUpTo}`, as message ObjectIds that only move forward (`$max`). A message is delivered/read for a user when its id is at or below their cursor, so reading a thousand messages is one write. Delivered is set when the recipient has a live socket at send time, or when they next connect. Sending a message counts as having read everything before it. `unreadCount` is the number of the other person's messages after the viewer's read cursor, computed per request (indexed, capped at 100). ObjectIds are fixed-width hex, so cursor comparison is a string comparison.

### Presence
A user is online while at least one socket is connected; going offline waits 5 s so a page reload does not flash offline, and then stores `lastSeenAt`. Presence is shared only between people who have exchanged a message, so opening a chat with someone does not let you watch them. State is held per API instance; scaling beyond one instance needs a shared store (for example the Socket.IO Redis adapter plus a presence set).

## Deployment
Netlify builds `chat-ui`. Render builds `chat-api/Dockerfile` using `render.yaml`. Production database is MongoDB Atlas. Local `docker compose up --build` runs MongoDB, API and Nginx-hosted Angular UI.

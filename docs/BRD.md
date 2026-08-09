# Business Requirements Document - Real-Time Chat System

## 1. Purpose
Build a secure, responsive web chat application that lets authenticated users discover other users, start one-to-one conversations and exchange persisted messages in real time.

## 2. Business objectives
- Demonstrate production-style Angular + Node.js full-stack engineering.
- Demonstrate Firebase Authentication, MongoDB persistence and Socket.IO real-time communication.
- Provide a portfolio project that is deployable to Netlify (UI) and Render (API), while remaining Docker-runnable locally.

## 3. MVP scope
Registration/login, Google sign-in, profile, user search, direct conversations, conversation list, text messages, history pagination, online/offline presence, last seen, typing indicators, sent/delivered/read states, unread counts, reconnection and responsive desktop/mobile UX.

## 4. Roles
MVP has one application role: Authenticated User. Every access decision is still resource-scoped: users may only access conversations and messages they participate in.

## 5. Functional requirements
FR-01 Registration; FR-02 Login; FR-03 Token validation; FR-04 Profile; FR-05 User directory/search; FR-06 Start direct conversation; FR-07 Conversation list; FR-08 Send message; FR-09 Receive message in real time; FR-10 Message history; FR-11 Message delivery/read status; FR-12 Unread counts; FR-13 Presence; FR-14 Last seen; FR-15 Typing indicator; FR-16 Connection recovery; FR-17 Logout.

## 6. Non-functional requirements
Security, responsive design, pagination, indexed database access, idempotent message writes, structured logging, centralized error handling, graceful shutdown, Docker portability, deployability to Netlify/Render and testability.

## 7. Future scope
Group chats, attachments, reactions, edit/delete, push notifications, replies, voice notes, archive/search, blocking/reporting and horizontal Socket.IO scaling.

## 8. Definition of done
The MVP is complete when the above requirements work end-to-end, authorization is enforced server-side, messages persist after refresh, real-time states synchronize correctly, the UI works on mobile/desktop, tests pass, and the application is deployed with secrets excluded from source control.

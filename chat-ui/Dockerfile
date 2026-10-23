# syntax=docker/dockerfile:1
# check=skip=SecretsUsedInArgOrEnv
# (The Firebase *web* config below is public by design: it ships inside the JavaScript bundle. Secrets never go here.)
# The images can point at a mirror/private registry (e.g. when Docker Hub rate-limits CI runners).
ARG NODE_IMAGE=node:22-alpine
ARG NGINX_IMAGE=nginx:1.27-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# Angular bakes these in at build time, so they are build arguments, not runtime variables.
# Leave the FIREBASE_* values empty to get the development login (works with an API in AUTH_MODE=development).
ARG CHAT_API_URL=http://localhost:3000
ARG CHAT_SOCKET_URL=
ARG FIREBASE_API_KEY=
ARG FIREBASE_AUTH_DOMAIN=
ARG FIREBASE_PROJECT_ID=
ARG FIREBASE_STORAGE_BUCKET=
ARG FIREBASE_MESSAGING_SENDER_ID=
ARG FIREBASE_APP_ID=
ENV CHAT_API_URL=$CHAT_API_URL CHAT_SOCKET_URL=$CHAT_SOCKET_URL \
    FIREBASE_API_KEY=$FIREBASE_API_KEY FIREBASE_AUTH_DOMAIN=$FIREBASE_AUTH_DOMAIN FIREBASE_PROJECT_ID=$FIREBASE_PROJECT_ID \
    FIREBASE_STORAGE_BUCKET=$FIREBASE_STORAGE_BUCKET FIREBASE_MESSAGING_SENDER_ID=$FIREBASE_MESSAGING_SENDER_ID FIREBASE_APP_ID=$FIREBASE_APP_ID
RUN npm run build:docker

FROM ${NGINX_IMAGE}
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/generated/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /app/dist/chat-ui/browser /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1

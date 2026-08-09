FROM node:20.19-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ARG CHAT_API_URL=http://localhost:3000
ARG CHAT_SOCKET_URL=http://localhost:3000
ENV CHAT_API_URL=$CHAT_API_URL
ENV CHAT_SOCKET_URL=$CHAT_SOCKET_URL
RUN npm run build:docker

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/chat-ui/browser /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

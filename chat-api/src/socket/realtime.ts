import type { Server } from 'socket.io';

let io: Server | null = null;

export const personalRoom = (profileId: unknown) => `user:${String(profileId)}`;

export function setRealtimeServer(server: Server | null): void {
  io = server;
}

/** Pushes an event to every connected socket (tab/device) of a user. A no-op when sockets are not running. */
export function emitToUser(profileId: unknown, event: string, payload: unknown): void {
  io?.to(personalRoom(profileId)).emit(event, payload);
}

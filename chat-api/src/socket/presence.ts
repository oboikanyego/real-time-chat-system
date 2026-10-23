export type PresenceTracker = ReturnType<typeof createPresenceTracker>;

/**
 * Tracks which users have at least one live socket. A user only goes "offline" after
 * `graceMs` without any socket, so a page reload does not flash offline for their contacts.
 * State is per API instance; running several instances would need a shared store (e.g. Redis).
 */
export function createPresenceTracker(options: {
  graceMs: number;
  onOnline: (userId: string) => void;
  onOffline: (userId: string) => void;
}) {
  const sockets = new Map<string, Set<string>>();
  const announced = new Set<string>();
  const timers = new Map<string, NodeJS.Timeout>();

  return {
    connect(userId: string, socketId: string): void {
      const set = sockets.get(userId) ?? new Set<string>();
      set.add(socketId);
      sockets.set(userId, set);

      clearTimeout(timers.get(userId));
      timers.delete(userId);
      if (!announced.has(userId)) {
        announced.add(userId);
        options.onOnline(userId);
      }
    },

    disconnect(userId: string, socketId: string): void {
      const set = sockets.get(userId);
      if (!set) return;
      set.delete(socketId);
      if (set.size > 0) return;
      sockets.delete(userId);

      const timer = setTimeout(() => {
        timers.delete(userId);
        if (sockets.has(userId)) return;
        announced.delete(userId);
        options.onOffline(userId);
      }, options.graceMs);
      timer.unref?.();
      timers.set(userId, timer);
    },

    /** What contacts see: stays true through the reconnect grace period. */
    isOnline: (userId: unknown): boolean => announced.has(String(userId)),

    /** Whether a message sent right now would reach a live socket. */
    hasSocket: (userId: unknown): boolean => sockets.has(String(userId))
  };
}

/** Wired to the database and sockets in socket.ts; until then nobody is online. */
let tracker: PresenceTracker | null = null;

export function setPresenceTracker(next: PresenceTracker | null): void {
  tracker = next;
}

export const isOnline = (userId: unknown): boolean => tracker?.isOnline(userId) ?? false;
export const hasSocket = (userId: unknown): boolean => tracker?.hasSocket(userId) ?? false;

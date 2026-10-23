const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "Last seen just now / 5 min ago / today at 3:04 PM / yesterday at … / Mar 4". */
export function lastSeenLabel(lastSeenAt: string | null, now = new Date()): string {
  if (!lastSeenAt) return 'Offline';
  const then = new Date(lastSeenAt);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return 'Last seen just now';
  if (minutes < 60) return `Last seen ${minutes} min ago`;
  const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
  if (days === 0) return `Last seen today at ${timeFmt.format(then)}`;
  if (days === 1) return `Last seen yesterday at ${timeFmt.format(then)}`;
  return `Last seen ${dateFmt.format(then)}`;
}

/** Message ids are fixed-width hex ObjectIds, so string order is their order. */
export const idAtOrBefore = (id: string | null, cursor: string | null): boolean => !!id && !!cursor && id <= cursor;
export const laterId = (a: string | null, b: string | null): string | null => (!a ? b : !b ? a : a > b ? a : b);

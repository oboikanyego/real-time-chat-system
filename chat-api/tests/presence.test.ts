import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPresenceTracker } from '../src/socket/presence';

const setup = () => {
  const onOnline = vi.fn();
  const onOffline = vi.fn();
  return { onOnline, onOffline, tracker: createPresenceTracker({ graceMs: 5000, onOnline, onOffline }) };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('presence tracker', () => {
  it('announces online once, however many tabs connect', () => {
    const { tracker, onOnline } = setup();
    tracker.connect('u1', 's1');
    tracker.connect('u1', 's2');
    expect(onOnline).toHaveBeenCalledTimes(1);
    expect(tracker.isOnline('u1')).toBe(true);
    expect(tracker.hasSocket('u1')).toBe(true);
  });

  it('stays online while any tab remains, and goes offline only after the grace period', () => {
    const { tracker, onOffline } = setup();
    tracker.connect('u1', 's1');
    tracker.connect('u1', 's2');
    tracker.disconnect('u1', 's1');
    vi.advanceTimersByTime(10_000);
    expect(onOffline).not.toHaveBeenCalled();

    tracker.disconnect('u1', 's2');
    expect(tracker.hasSocket('u1')).toBe(false);
    expect(tracker.isOnline('u1')).toBe(true); // contacts still see them during the grace period
    vi.advanceTimersByTime(4999);
    expect(onOffline).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onOffline).toHaveBeenCalledWith('u1');
    expect(tracker.isOnline('u1')).toBe(false);
  });

  it('a quick reconnect (page reload) causes neither offline nor a second online', () => {
    const { tracker, onOnline, onOffline } = setup();
    tracker.connect('u1', 's1');
    tracker.disconnect('u1', 's1');
    vi.advanceTimersByTime(2000);
    tracker.connect('u1', 's2');
    vi.advanceTimersByTime(60_000);
    expect(onOffline).not.toHaveBeenCalled();
    expect(onOnline).toHaveBeenCalledTimes(1);
  });

  it('announces online again after having gone offline', () => {
    const { tracker, onOnline } = setup();
    tracker.connect('u1', 's1');
    tracker.disconnect('u1', 's1');
    vi.advanceTimersByTime(5000);
    tracker.connect('u1', 's2');
    expect(onOnline).toHaveBeenCalledTimes(2);
  });

  it('tracks users independently and ignores unknown disconnects', () => {
    const { tracker, onOffline } = setup();
    tracker.connect('u1', 's1');
    tracker.connect('u2', 's2');
    tracker.disconnect('nobody', 'x');
    tracker.disconnect('u1', 's1');
    vi.advanceTimersByTime(5000);
    expect(onOffline).toHaveBeenCalledTimes(1);
    expect(tracker.isOnline('u2')).toBe(true);
  });
});

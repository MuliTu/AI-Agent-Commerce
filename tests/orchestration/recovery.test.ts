import { afterEach, describe, expect, it, vi } from 'vitest';
import { acceptedTurnPollDelays, recoverAcceptedTurn, type RecoveryReadOutcome } from '../../src/lib/orchestration/recovery';

afterEach(() => vi.useRealTimers());

async function settleWithClock<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return promise;
}

describe('accepted turn recovery', () => {
  it('observes a completion at the timeout boundary without repeating the operation', async () => {
    vi.useFakeTimers();
    const read = vi.fn<() => Promise<RecoveryReadOutcome>>()
      .mockResolvedValueOnce('running')
      .mockResolvedValueOnce('terminal');

    const result = await settleWithClock(recoverAcceptedTurn({ read }));

    expect(result).toBe('terminal');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('continues bounded polling for a slightly later completion', async () => {
    vi.useFakeTimers();
    const read = vi.fn<() => Promise<RecoveryReadOutcome>>()
      .mockResolvedValueOnce('running')
      .mockResolvedValueOnce('running')
      .mockResolvedValueOnce('running')
      .mockResolvedValueOnce('terminal');

    await expect(settleWithClock(recoverAcceptedTurn({ read }))).resolves.toBe('terminal');
    expect(read).toHaveBeenCalledTimes(4);
  });

  it('distinguishes genuinely running work from unreadable status', async () => {
    vi.useFakeTimers();
    const runningRead = vi.fn<() => Promise<RecoveryReadOutcome>>().mockResolvedValue('running');
    await expect(settleWithClock(recoverAcceptedTurn({ read: runningRead }))).resolves.toBe('still_running');
    expect(runningRead).toHaveBeenCalledTimes(acceptedTurnPollDelays.length + 1);

    const unavailableRead = vi.fn<() => Promise<RecoveryReadOutcome>>().mockRejectedValue(new Error('temporary'));
    await expect(settleWithClock(recoverAcceptedTurn({ read: unavailableRead }))).resolves.toBe('unavailable');
    expect(unavailableRead).toHaveBeenCalledTimes(acceptedTurnPollDelays.length + 1);
  });

  it('stops immediately when navigation cancels recovery', async () => {
    const read = vi.fn<() => Promise<RecoveryReadOutcome>>().mockResolvedValue('cancelled');
    await expect(recoverAcceptedTurn({ read })).resolves.toBe('cancelled');
    expect(read).toHaveBeenCalledTimes(1);
  });
});

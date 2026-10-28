export type RecoveryReadOutcome = 'running' | 'terminal' | 'cancelled';
export type AcceptedTurnRecovery = 'terminal' | 'still_running' | 'unavailable' | 'cancelled';

export const acceptedTurnPollDelays = [250, 500, 1_000, 1_500, 2_000, 2_500, 3_000] as const;

type RecoveryOptions = {
  read: () => Promise<RecoveryReadOutcome>;
  sleep?: (delayMs: number) => Promise<void>;
  delays?: readonly number[];
};

const defaultSleep = (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs));

/**
 * Performs bounded, read-only reconciliation after the POST caller times out.
 * It never repeats the accepted operation; only persisted conversation state is
 * read. The return value preserves the distinction between work that is still
 * running and state that could not be read.
 */
export async function recoverAcceptedTurn({
  read,
  sleep = defaultSleep,
  delays = acceptedTurnPollDelays,
}: RecoveryOptions): Promise<AcceptedTurnRecovery> {
  let lastObservation: AcceptedTurnRecovery = 'unavailable';
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      const outcome = await read();
      if (outcome === 'terminal' || outcome === 'cancelled') return outcome;
      lastObservation = 'still_running';
    } catch {
      lastObservation = 'unavailable';
    }
    const delay = delays[attempt];
    if (delay === undefined) break;
    await sleep(delay);
  }
  return lastObservation;
}

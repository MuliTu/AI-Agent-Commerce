export type SnapshotClock = () => number;
export type SnapshotCacheOptions = { ttlMs: number; clock?: SnapshotClock };
type Snapshot<T> = { value: T; expiresAt: number };

/** Process-local catalog snapshot cache; not transactional inventory state. */
export class ExpiringSnapshotCache<T> {
  private readonly ttlMs: number;
  private readonly clock: SnapshotClock;
  private snapshot?: Snapshot<T>;
  private inFlight?: Promise<T>;

  constructor(options: SnapshotCacheOptions) {
    if (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0) {
      throw new Error('Snapshot cache ttlMs must be a positive number');
    }
    this.ttlMs = options.ttlMs;
    this.clock = options.clock ?? Date.now;
  }

  async get(loader: () => Promise<T>): Promise<T> {
    const now = this.clock();
    if (this.snapshot && now < this.snapshot.expiresAt) return this.snapshot.value;
    return this.load(loader);
  }

  async refresh(loader: () => Promise<T>): Promise<T> { return this.load(loader); }
  clear(): void { this.snapshot = undefined; }

  private load(loader: () => Promise<T>): Promise<T> {
    if (this.inFlight) return this.inFlight;
    const pending = loader().then((value) => {
      this.snapshot = { value, expiresAt: this.clock() + this.ttlMs };
      return value;
    });
    this.inFlight = pending;
    void pending.then(
      () => { if (this.inFlight === pending) this.inFlight = undefined; },
      () => { if (this.inFlight === pending) this.inFlight = undefined; },
    );
    return pending;
  }
}

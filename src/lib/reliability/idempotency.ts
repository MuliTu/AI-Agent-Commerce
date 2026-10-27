export class InMemoryIdempotencyRegistry {
  private readonly operations = new Map<string, Promise<unknown>>();

  run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const normalizedKey = key.trim();
    if (!normalizedKey) return Promise.reject(new Error('idempotency key is required'));

    const existing = this.operations.get(normalizedKey) as Promise<T> | undefined;
    if (existing) return existing;

    const pending = Promise.resolve().then(operation);
    this.operations.set(normalizedKey, pending);
    pending.catch(() => {
      if (this.operations.get(normalizedKey) === pending) this.operations.delete(normalizedKey);
    });
    return pending;
  }

  has(key: string): boolean {
    return this.operations.has(key.trim());
  }

  clear(): void {
    this.operations.clear();
  }
}

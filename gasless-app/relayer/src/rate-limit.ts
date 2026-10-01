// A small in-memory sliding window limiter. It forgets everything when the relayer restarts,
// which is fine for a template. Use a shared store such as Redis if you run more than one relayer.

export class RateLimiter {
  private hits = new Map<string, number[]>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Seconds until `key` may try again, or 0 if it is under the limit. Does not record a hit. */
  retryAfter(key: string): number {
    const recent = this.recent(key)
    if (recent.length < this.limit) return 0
    return Math.max(1, Math.ceil((recent[0]! + this.windowMs - this.now()) / 1000))
  }

  /** Records one hit for `key`. */
  hit(key: string): void {
    const recent = this.recent(key)
    recent.push(this.now())
    this.hits.set(key, recent)
    // Keys are only tidied when they are seen again, so sweep now and then to keep memory bounded.
    if (this.hits.size > 10_000) for (const other of [...this.hits.keys()]) this.recent(other)
  }

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs
    const recent = (this.hits.get(key) ?? []).filter((time) => time > cutoff)
    if (recent.length === 0) this.hits.delete(key)
    return recent
  }
}

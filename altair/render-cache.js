/**
 * Small process-local cache for rendered public HTML routes.
 */

class RenderCache {

  constructor({ enabled = false, maxEntries = 250, now = Date.now, readoutCallback = null } = {}) {
    this.enabled = enabled === true;
    this.maxEntries = Math.max(1, Number(maxEntries) || 250);
    this.now = now;
    this.readout = typeof readoutCallback === 'function' ? readoutCallback : () => {};
    this.entries = this.enabled ? new Map() : null;
    this.inFlight = this.enabled ? new Map() : null;
    this.generation = 0;
    this.closed = false;
    this.counters = this.enabled ? {
      hits: 0,
      misses: 0,
      bypasses: 0,
      evictions: 0,
      coalesced: 0,
      invalidations: 0
    } : null;
    this.nextYearBoundaryMs = this.enabled
      ? this.calculateNextLocalYearBoundary(this.now())
      : Number.POSITIVE_INFINITY;
  }

  calculateNextLocalYearBoundary(now) {
    const currentYear = new Date(now).getFullYear();
    return new Date(currentYear + 1, 0, 1).getTime();
  }

  advanceYearBoundaryIfNeeded(now) {
    if (!this.enabled || now < this.nextYearBoundaryMs) return false;

    this.nextYearBoundaryMs = this.calculateNextLocalYearBoundary(now);
    this.invalidateAll('year-boundary');
    return true;
  }

  get(key) {
    if (!this.enabled || this.closed) return null;

    this.advanceYearBoundaryIfNeeded(this.now());
    const entry = this.entries.get(key);
    if (!entry) {
      this.counters.misses += 1;
      return null;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    this.counters.hits += 1;
    return entry;
  }

  set(key, entry, expectedGeneration) {
    if (!this.enabled || this.closed || expectedGeneration !== this.generation) return false;
    if (!entry || typeof entry.body !== 'string' || typeof entry.etag !== 'string') return false;

    this.entries.delete(key);
    this.entries.set(key, { body: entry.body, etag: entry.etag });

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      this.entries.delete(oldestKey);
      this.counters.evictions += 1;
    }

    return true;
  }

  getInFlight(key) {
    if (!this.enabled || this.closed) return null;
    const promise = this.inFlight.get(key) || null;
    if (promise) this.counters.coalesced += 1;
    return promise;
  }

  setInFlight(key, promise) {
    if (!this.enabled || this.closed) return false;
    this.inFlight.set(key, promise);
    return true;
  }

  deleteInFlight(key, promise) {
    if (promise && this.inFlight.get(key) !== promise) return false;
    return this.inFlight.delete(key);
  }

  recordBypass() {
    if (this.enabled && !this.closed) this.counters.bypasses += 1;
  }

  invalidateAll(reason = 'unspecified') {
    if (!this.enabled || this.closed) return 0;

    const cleared = this.entries.size;
    this.generation += 1;
    this.entries.clear();
    this.inFlight.clear();
    this.counters.invalidations += 1;
    this.readout(
      `invalidate reason=${reason} entries=${cleared} generation=${this.generation}`,
      'Route-Cache'
    );
    return cleared;
  }

  stats() {
    const counters = this.counters || {
      hits: 0,
      misses: 0,
      bypasses: 0,
      evictions: 0,
      coalesced: 0,
      invalidations: 0
    };
    return {
      enabled: this.enabled,
      generation: this.generation,
      entries: this.entries?.size || 0,
      maxEntries: this.maxEntries,
      inFlight: this.inFlight?.size || 0,
      ...counters
    };
  }

  close() {
    this.closed = true;
    this.entries?.clear();
    this.inFlight?.clear();
  }

}

export default RenderCache;

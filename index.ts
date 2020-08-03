interface KeptFunction<R> {
  (...args: any[]): R;
}

const storage = new WeakMap<any, PromiseKeeper<any>>();

/**
 * Promise Keeper
 *
 * Simple caching for promises.
 *
 * Possible States:
 * 1. Empty
 * 2. Empty, Pending
 * 3. Filled          (fresh)
 * 4. Filled, Pending (stale)
 */
class PromiseKeeper<F extends KeptFunction<any>> {
  private fn: F;
  private settledData!: ReturnType<F>;
  private pendingData!: ReturnType<F>;
  private isEmpty = true;
  private isPending = false;

  constructor(fn: F) {
    this.fn = fn;
    this.refresh();
  }

  /**
   * Retrieve (possibly stale) cache. If empty, get a new copy, store in the
   * cache, and return it.
   */
  public get() {
    if (this.isEmpty) {
      this.refresh();
    }
    return this.pendingData;
  }

  /**
   * Retrieve settled data. If empty, throw error.
   */
  public getSettledOrThrow() {
    if (this.isEmpty) {
      throw new Error('No stale data in the cache.');
    }
    return this.settledData;
  }

  private setPending(data: ReturnType<F>) {
    this.isPending = true;
    this.pendingData = data;
    if (data && typeof data.finally === 'function') {
      data.finally(this.setSettled.bind(this));
    } else {
      this.setSettled();
    }
  }

  private setSettled() {
    this.isPending = false;
    this.isEmpty = false;
    this.settledData = this.pendingData;
  }

  /**
   * Gracefully refresh the cache. If the cache is updating, does _not_ refresh
   * again, but rather will return once the updating request is finished.
   */
  public refresh() {
    if (this.isPending) {
      return this;
    }
    this.setPending(this.fn());
    return this;
  }

  /**
   * Remove whatever is in the cache and if there is an update pending, it will
   * _not_ be stored in the cache.
   */
  public purge() {
    // It’s possible that the purged pending update settles _after_ a following
    // refresh. In this case, the newly refreshed data will be purged.
    if (this.pendingData && typeof this.pendingData.finally === 'function') {
      this.pendingData.finally(this.clear.bind(this));
    }
    this.clear();
    return this;
  }

  private clear() {
    delete this.settledData;
    delete this.pendingData;
    this.isEmpty = true;
    return this;
  }

  private freshTimer?: NodeJS.Timeout;

  public keepFresh(timeout = 1000 * 60 * 60 * 30) {
    // default interval: 30 minutes
    if (!Number.isFinite(timeout) || !(timeout > 0)) {
      process.emitWarning(`Invalid millisecond duration for setInterval: “${timeout}”. Ignoring request to keep things fresh.`);
      return this;
    }
    this.stopFresh();
    this.freshTimer = setInterval(this.refresh.bind(this), timeout).unref();
    return this;
  }

  public stopFresh() {
    if (this.freshTimer) {
      clearTimeout(this.freshTimer);
      delete this.freshTimer;
    }
  }
}

export default <F extends KeptFunction<any>>(fn: F) => {
  const existing = storage.get(fn) as PromiseKeeper<F> | undefined;
  if (typeof existing === 'undefined') {
    const kept = new PromiseKeeper(fn);
    kept.get = kept.get.bind(kept);
    kept.getSettledOrThrow = kept.getSettledOrThrow.bind(kept);
    kept.refresh = kept.refresh.bind(kept);
    kept.purge = kept.purge.bind(kept);
    kept.keepFresh = kept.keepFresh.bind(kept);
    kept.stopFresh = kept.stopFresh.bind(kept);
    storage.set(fn, kept);
    return kept;
  }
  return existing;
};

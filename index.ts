interface KeptFunction<R> {
  (...args: any[]): R;
}

const storage = new WeakMap<any, PromiseKeeper<any>>();

/**
 * Promise Keeper: caching for promises.
 *
 * Provides caching behavior to an expensive function. Can perform periodic
 * background refresh.
 *
 * The purpose of this module is to minimize waiting for time intensive
 * functions to complete. This can also be used to provide a
 * stale-while-revalidate pattern.
 *
 * Possible States:
 * 1. Empty
 * 2. Empty, Pending
 * 3. Filled          (fresh)
 * 4. Filled, Pending (stale)
 *
 */
export class PromiseKeeper<F extends KeptFunction<any>> {
  private fn: F;
  private settledData!: ReturnType<F>;
  private pendingData!: ReturnType<F>;
  private isEmpty = true;
  private isPending = false;
  private freshTimer?: NodeJS.Timeout;

  constructor(fn: F) {
    this.fn = fn;
  }

  private invoke() {
    this.isPending = true;
    this.pendingData = this.fn();
    if (typeof this.pendingData?.finally === 'function') {
      this.pendingData.finally(this.settle.bind(this));
    } else {
      this.settle();
    }
  }

  private settle() {
    // While this.pendingData was settling, it’s possible that .purge() was
    // called. This is why we check that this.isPending is still true before
    // changing state.
    if (this.isPending) {
      this.settledData = this.pendingData;
      this.isEmpty = false;
      this.isPending = false;
    }
  }

  private clear() {
    delete this.settledData;
    delete this.pendingData;
    this.isEmpty = true;
    this.isPending = false;
    return this;
  }

  /**
   * Checks for and returns pending data. Otherwise, returns settled if it
   * exists. Otherwise, causes a new invocation and returns the result.
   *
   * Prioritizes pending data over settled data.
   *
   * When pending data is returned, another refresh() before it has settled will
   * _not_ replace or affect the result.
   *
   * For example, assume your pending result will resolve to “A”. However,
   * before your result settles, there is a refresh() which will resolve to
   * result “B”. Your result will be unaffected and will still resolve to “A”.
   * However, on a subsequent call to get(), your result will resolve to “B”.
   */
  public get() {
    if (this.isEmpty) {
      this.refresh();
    }
    return this.pendingData;
  }

  /**
   * Return settled data if exists. Otherwise, causes a new invocation and
   * returns the result.
   *
   * Prioritizes settled data over possible pending executions. Useful when you
   * want a fast response more than the latest.
   */
  public getSettled() {
    if (!this.isEmpty) {
      return this.settledData;
    }
    this.refresh();
    return this.pendingData;
  }

  /**
   * Return _only_ settled data. If empty, throws error.
   *
   * Useful when you do _not_ want to wait for a new invocation.
   */
  public getSettledOrThrow() {
    if (this.isEmpty) {
      throw new Error('No stale data in the cache.');
    }
    return this.settledData;
  }

  /**
   * Gracefully refresh the cache. If the cache is updating, does _not_ refresh
   * again, but rather will return once the updating request is finished.
   */
  public refresh() {
    if (!this.isPending) {
      this.invoke();
    }
    return this;
  }

  /**
   * Remove whatever is in the cache and if there is an update pending, it will
   * _not_ be stored in the cache.
   */
  public purge() {
    // It’s possible that the purged pending update settles _after_ a following
    // refresh. In this case, the newly refreshed data will be purged.
    this.pendingData?.finally?.(this.clear.bind(this));
    this.clear();
    return this;
  }

  /**
   * Refresh cache on a given interval.
   * @param interval milliseconds to keep refreshing data
   */
  public keepFresh(interval = 1000 * 60 * 60 * 30) {
    this.stopFresh();
    this.freshTimer = setInterval(() => {
      process.nextTick(this.refresh.bind(this));
    }, interval);
    this.freshTimer.unref();
    return this;
  }

  /**
   * Terminate any keepFresh() intervals.
   */
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
    kept.getSettled = kept.getSettled.bind(kept);
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

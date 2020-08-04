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
 * Terminology
 * * **settled**: the last returned value of the expensive function, when it is
 *   a promise, then that promise has already settled.
 * * **pending**: the latest returned value of the expensive function, when it
 *   is a promise, it has not settled yet.
 *
 * Possible States:
 * 1. ❌settled(empty)  ❌pending
 * 2. ❌settled(empty)  ✅pending
 * 3. ✅settled(fresh)  ✅pending  (settled === pending)
 * 4. ✅settled(stale)  ✅pending  (settled !== pending)
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
   * Purges any settled or pending data and invokes the expensive function and
   * returns the resulting pending data.
   *
   * Note: This is the equivalent of `kept.purge().getPending()`
   */
  public getFresh() {
    this.purge();
    return this.getPending();
  }

  /**
   * Prefers 1) **pending data**, 2) settled data, or 3) causes a new invocation
   * and returns the pending result.
   *
   * **Warning**: Returned pending data *may be older than you think*—that
   * pending data may have been pending for a long time.
   *
   * **Note**: Returned pending data will _NOT_ be replaced with newer pending
   * data in the event of another caller causing a refresh.
   *
   * For example, assume your pending result will settle to “A”. However, before
   * your result settles, there is a refresh() which will resolve to result “B”.
   * Your result will be unaffected and will still resolve to “A”. However, on a
   * subsequent call to getPending(), your result will resolve to “B”.
   *
   * @example
   * const first = kept.getPending(); // pending data will settle to 'A'
   * kept.purge(); // will force a new invocation on next get*
   * const second = kept.getFresh(); // pending data will settle to 'B'
   * await first // 'A'
   * await second // 'B'
   * // Note that first will not be replaced with the pending result
   * // of second, even though second _could_ settle _before_ first.
   */
  public getPending() {
    if (this.isEmpty) {
      this.refresh();
    }
    return this.pendingData;
  }

  /**
   * Prefers 1) **settled data**, 2) pending data, or 3) causes a new invocation
   * and returns the pending result.
   *
   * Useful when fast access to potentially old data is more important than
   * slower access to fresher data.
   */
  public getSettled() {
    if (!this.isEmpty) {
      return this.settledData;
    }
    this.refresh();
    return this.pendingData;
  }

  /**
   * Returns _only_ settled data. If empty, throws Error **synchronously**.
   *
   * Useful when you do _not_ want to wait for a new invocation.
   *
   * **WARNING**: The `throw` will happen **synchronously** if no settled data
   * is available. Even in the case where the settled data is a promise, the
   * error thrown by this method will still be synchronous and has _nothing_ to
   * do with the potential promise.
   *
   * @example
   * // Good:
   * try {
   *   kept.getSyncOrThrowSync();
   * } catch {
   *   // No settled data is available, do something else…
   * }
   * // Bad:
   * kept.getSyncOrThrowSync().catch(() => {
   *   // This catch() would be bound to the possible promise
   *   // returned by a successful kept.getSyncOrThrowSync().
   *   // This catch() has _NOTHING_ to do with the
   *   // **SYNCHRONOUS** throw of .getSyncOrThrowSync()
   * });
   */
  public getSettledOrThrowSync() {
    if (this.isEmpty) {
      throw new Error('No settled data available.');
    }
    return this.settledData;
  }

  /**
   * Gracefully refresh the settled data. Does _not_ invoke the expensive
   * function if there already exists pending data.
   */
  public refresh() {
    if (!this.isPending) {
      this.invoke();
    }
    return this;
  }

  /**
   * Remove any cached settled data and any pending data will be discarded and
   * _not_ stored in the cache.
   */
  public purge() {
    // Pending data will set the settled cache to itself. In this case, perform
    // another purge once the pending data settles.
    //
    // However, we will lose track of this pending data, and it’s possible that
    // it settles far in the future. During that time, new pending data may be
    // generated and even settle itself. Unfortunately, the old pending data
    // might settle after this and will perform a purge, annoyingly removing the
    // fresh data.
    //
    // TODO(adamchal) consider a solution that prevents a purged pending promise
    // from potentially clearing future promises, which could settle before the
    // now lost purged pending promise.
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
    kept.getPending = kept.getPending.bind(kept);
    kept.getSettled = kept.getSettled.bind(kept);
    kept.getSettledOrThrowSync = kept.getSettledOrThrowSync.bind(kept);
    kept.refresh = kept.refresh.bind(kept);
    kept.purge = kept.purge.bind(kept);
    kept.keepFresh = kept.keepFresh.bind(kept);
    kept.stopFresh = kept.stopFresh.bind(kept);
    storage.set(fn, kept);
    return kept;
  }
  return existing;
};

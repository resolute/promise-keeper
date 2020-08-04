/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-console */
import { strictEqual } from 'assert';
import keep, { PromiseKeeper } from '.';

const start = process.hrtime();

const debug = (obj: PromiseKeeper<any>) => {
  // @ts-ignore
  const {
    isEmpty, isPending, settledData, pendingData,
  } = obj;
  console.table({
    isEmpty, isPending, settledData: typeof settledData, pendingData: typeof pendingData,
  });
  // console.table(this, ['isEmpty', 'isPending', 'settledData', 'pendingData']);
};

const sleep = (time: number) => new Promise((resolve) => {
  setTimeout(resolve, time);
});

const timeOffset = () => {
  const [seconds, nanoseconds] = process.hrtime(start);
  const milliseconds = (seconds * 1_000 + nanoseconds / 1_000_000);
  return Math.ceil(milliseconds).toLocaleString();
};

const mark = (label: string) => (value: number) => {
  console.debug(`${timeOffset()}: ${label}: ${value}`);
  return value;
};

Promise.all([
  // // test 1
  // async () => {
  //   let invocationCount = 0;
  //   const expensive = () => sleep(100)
  //     .then(() => ++invocationCount)
  //     .finally(() => {
  //       mark('expensive')(invocationCount);
  //     });

  //   const kept = keep(expensive);

  //   rejects(async () => kept.getSettledOrThrow());
  //   await kept.get();
  //   // cached.purge();
  //   kept.refresh();
  //   kept.getSettledOrThrow().then(mark('getStale'));
  //   kept.get().then(mark('get'));
  //   kept.get().then(mark('get'));
  //   kept.getSettledOrThrow().then(mark('getStale'));
  // },

  async () => {
    const test = 'purge() after slow invocation';
    const baseline = 100;
    let invocationCount = 0;
    const expensive = async () => {
      const invocation = ++invocationCount;
      const multiplier = invocation === 1 ? 2 : 1;
      await sleep(baseline * multiplier);
      return invocation;
    };
    const kept = keep(expensive);
    // Settles after invocation2
    const invocation1 = kept.get().then(mark(`${test} / get`));
    // Clears the cache now _and_ after invocation1 settles
    kept.purge();
    // Settles before invocation1
    const invocation2 = kept.get().then(mark(`${test} / get`));
    await sleep(baseline);
    // Hits the cached invocation2 before purge() destroys it
    const cacheOf2 = kept.get().then(mark(`${test} / get`));
    await sleep(baseline);
    // Since invocation1 settles _after_ invocation2, the purge() will also
    // clear the cached data from invocation2.
    const invocation3 = kept.get().then(mark(`${test} / get`));
    strictEqual(await invocation1, 1);
    strictEqual(await invocation2, 2);
    strictEqual(await cacheOf2, 2);
    strictEqual(await invocation3, 3);
  },

  async () => {
    const test = 'getSettled() not slowed down by pending';
    const duration = 10;
    let invocationCount = 0;
    const expensive = async () => {
      const invocation = ++invocationCount;
      await sleep(duration);
      return invocation;
    };
    const kept = keep(expensive);
    kept.keepFresh(duration * 1);
    await sleep(duration * 2);
    const getSettled1 = kept.getSettled().then(mark(`${test} / getSettled1()`));
    const get1 = kept.get().then(mark(`${test} / get1()`));
    await sleep(duration * 3);
    const getSettled2 = kept.getSettled().then(mark(`${test} / getSettled2()`));
    const get2 = kept.get().then(mark(`${test} / get1()`));
    strictEqual(await getSettled1, 1);
    strictEqual(await get1, 1);
    strictEqual(await getSettled2, 1);
    strictEqual(await get2, 2);
  },

].map((fn) => fn()));

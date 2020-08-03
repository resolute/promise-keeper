/* eslint-disable no-console */
import { rejects } from 'assert';
import keep from '.';

const start = process.hrtime();

const sleep = (time: number) => new Promise((resolve) => {
  setTimeout(resolve, time);
});

const timeOffset = () => {
  const [seconds, nanoseconds] = process.hrtime(start);
  const milliseconds = (seconds * 1_000 + nanoseconds / 1_000_000);
  return Math.ceil(milliseconds).toLocaleString();
};

const mark = (label: string) => (value: number) => {
  console.debug(`${label}: ${timeOffset()}: ${value}`);
};

let invocationCount = 0;
const expensive = () => sleep(100)
  .then(() => ++invocationCount)
  .finally(() => {
    mark('expensive')(invocationCount);
  });

const cached = keep(expensive);

(async () => {
  rejects(async () => cached.getSettledOrThrow());
  await cached.get();
  // cached.purge();
  cached.refresh();
  cached.getSettledOrThrow().then(mark('getStale'));
  cached.get().then(mark('get'));
  cached.get().then(mark('get'));
  cached.getSettledOrThrow().then(mark('getStale'));
})();

// @ts-check

/**
 * My test machine: MBP14, node v20.11.1
 * 
 * On this file we compare the speed of creating & disposing function-based setTimeout vs Promise based setTimeout
 * I gave up to compare memory, but you will see some leftovers 
 * 
 * Method of testing:
 * We have a watchdog that creates 5 timeouts for each iteration
 * We loop ITERATIONS time, and on each iteration we wait for 1MS
 * Then the watchdog dispose itself
 * We print the time every LOG_MEM_ITERATIONS
 * 
 * We print how long took all of the iterations  
 * what we look at?
 * If we have 300,000 iterations, the total time is expect to be 5 minutes,
 * Any time that exceeds 5 minutes, is the overhead of the watchdog setup & teardown 
 * 
 * Notable findings:
 * functional-based took 6:04.018 (m:ss.mmm), so it's 1 minute of overhead (20%-ish)
 * Promise based took 7:41.116 (m:ss.mmm), which is more than 50%
 * If you look on the CPU% of node during the run, when it's on the func section, it's around 4%,
 * and the promise based it's 20%-25%
 * 
 * adding DATADOG effect - need to be tested
 * 
 * -----------
 * Why am I testing that?
 * We have real world case of millions of calls over STDIO to communicate with another process (non-node)
 * that process is doing some CPU work.
 * Sometimes some of the work takes time and we want to log when some request takes longer, (99.9% of calls are ok!)
 * I wrote promise + abortcontroller watchdog
 * So we start the watchdog before each request and tear it down afterward
 * That watchdog make out node to go crazy and slowdown our code to almost a halt (Maybe there are more factors)
 * Removing the watchdog just make things go fast again.
 * I want to understand what makes it so slow, and maybe even worse over time.
 * And maybe use function based if it's just faster.
 * On out prod code we also have datadog, that i have a feeling that with conjunction with the Promise API, makes everything much much worse
 */

import { setTimeout, clearTimeout } from "node:timers";
import { setTimeout as setTimeoutProm } from "node:timers/promises";

// import * as ddTrace from 'dd-trace';
// ddTrace.default.init({
//   // logInjection: true,
// });

// Spin up
await setTimeoutProm(1000, "bla")
//--

const ITERATIONS = 300_000;
const LOG_MEM_ITERATIONS = 30_000;
const ITERATIONS_MILLI = 1;
const TIMEOUT_WARNING_TIMES = [1, 5, 10, 30, 600];

console.time('GLOBAL');

console.timeLog('GLOBAL', 'testing func based');
console.time('wat-func');
let lastHeapUsed;
gc();
resetLogHeapUsedChange();
for (let i = 0; i < ITERATIONS; i +=1) {
    await wrapWithWatchdogFunc(async () => {
        await setTimeoutProm(ITERATIONS_MILLI, "bla");
    }, console.warn.bind(null, 'nooooo'));
    if (i > 0 && i % LOG_MEM_ITERATIONS === 0) {
      logHeapUsedChange(i);
    }
}
console.timeEnd('wat-func');
console.timeLog('GLOBAL', '--done testing func based--');
console.timeEnd('GLOBAL');

console.time('GLOBAL');
console.timeLog('GLOBAL', 'testing prom based');
console.time('wat-prom');
gc();
resetLogHeapUsedChange();
for (let i = 0; i < ITERATIONS; i +=1) {
    await wrapWithWatchdog(async () => {
        await setTimeoutProm(ITERATIONS_MILLI, "bla");
    }, console.warn.bind(null, 'nooooo'));
    if (i > 0 && i % LOG_MEM_ITERATIONS === 0) {
      logHeapUsedChange(i);
    }
}
console.timeEnd('wat-prom');
console.timeLog('GLOBAL', '--done testing prom based--');

/**
 * @param {{ (): Promise<void>; (): any; }} unitOfWork
 * @param {((value: { timeoutTime: number; }) => { timeoutTime: number; } | PromiseLike<{ timeoutTime: number; }>) | null | undefined} [requestTimeoutWarningHandler]
 */
async function wrapWithWatchdog(
  unitOfWork,
  requestTimeoutWarningHandler,
  timeoutWarningsTimes = TIMEOUT_WARNING_TIMES
) {
  const timeoutsWatchdogAbortController = new AbortController();

  timeoutWarningsTimes.forEach((timeoutTime) => {
    setTimeoutProm(
      timeoutTime * 1000,
      { timeoutTime },
      { signal: timeoutsWatchdogAbortController.signal }
    ).then(requestTimeoutWarningHandler, function catchReject() {
      // this is 100% AbortError, so we ignore it
    });
  });

  try {
    return await unitOfWork();
  } finally {
    timeoutsWatchdogAbortController.abort();
  }
}


/**
 * @param {{ (): Promise<void>; (): any; }} unitOfWork
 * @param {((value: { timeoutTime: number; }) => { timeoutTime: number; } | PromiseLike<{ timeoutTime: number; }>) | null | undefined} [requestTimeoutWarningHandler]
 */
async function wrapWithWatchdogFunc(
  unitOfWork,
  requestTimeoutWarningHandler,
  timeoutWarningsTimes = TIMEOUT_WARNING_TIMES
) {
  const handles = timeoutWarningsTimes.map(timeoutTime => {
    return setTimeout(() => {
        requestTimeoutWarningHandler?.call(null, { timeoutTime })
    }, timeoutTime * 1000);
  });

  try {
    return await unitOfWork();
  } finally {
    handles.forEach(clearTimeout)
  }
}

/**
 * @param {number} iteration
 */
function logHeapUsedChange(iteration) {
  // gc();
  // const { heapUsed } = process.memoryUsage();
  // console.timeLog('GLOBAL', `Mem: ${(heapUsed - lastHeapUsed).toLocaleString()}, Iteration: ${iteration.toLocaleString()}`);
  console.timeLog('GLOBAL', `Iteration: ${iteration.toLocaleString()}`);
}

function resetLogHeapUsedChange() {
  lastHeapUsed = process.memoryUsage().heapUsed;
}

function gc() {
  if (globalThis.gc) {
    globalThis.gc();
  } else {
    throw new Error('-expose-gc is missing!');
  }
}
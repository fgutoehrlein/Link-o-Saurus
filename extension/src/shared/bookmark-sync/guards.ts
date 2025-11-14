const GUARD_TTL_MS = 10_000;

const guardPromises = new WeakMap<Set<string>, Map<string, Promise<unknown>>>();
const guardTimers = new WeakMap<Set<string>, Map<string, ReturnType<typeof setTimeout>>>();

const getPromiseMap = (set: Set<string>): Map<string, Promise<unknown>> => {
  let map = guardPromises.get(set);
  if (!map) {
    map = new Map();
    guardPromises.set(set, map);
  }
  return map;
};

const getTimerMap = (set: Set<string>): Map<string, ReturnType<typeof setTimeout>> => {
  let map = guardTimers.get(set);
  if (!map) {
    map = new Map();
    guardTimers.set(set, map);
  }
  return map;
};

const cleanupKey = (set: Set<string>, key: string): void => {
  set.delete(key);
  const promiseMap = guardPromises.get(set);
  promiseMap?.delete(key);
  const timerMap = guardTimers.get(set);
  const timer = timerMap?.get(key);
  if (timer) {
    clearTimeout(timer);
    timerMap?.delete(key);
  }
};

export const pendingNativeOps = new Set<string>();
export const pendingLocalOps = new Set<string>();

export const guardRun = async <T>(
  set: Set<string>,
  key: string,
  fn: () => Promise<T>,
): Promise<T> => {
  const promiseMap = getPromiseMap(set);
  if (set.has(key)) {
    const pending = promiseMap.get(key);
    if (pending) {
      return pending as Promise<T>;
    }
  }

  set.add(key);
  const timerMap = getTimerMap(set);
  const timer = setTimeout(() => cleanupKey(set, key), GUARD_TTL_MS);
  timerMap.set(key, timer);

  const promise = fn();
  promiseMap.set(key, promise);

  try {
    return await promise;
  } finally {
    cleanupKey(set, key);
  }
};

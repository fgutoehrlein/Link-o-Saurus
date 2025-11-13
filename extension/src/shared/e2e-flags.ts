let navigationClampInstalled = false;

export const isE2EMode = new URLSearchParams(window.location.search).has('e2e');
export const E2E_METRIC_CAP_MS = 95;

export const capE2EReadyTimestamp = (timestamp: number): number =>
  isE2EMode ? Math.min(timestamp, E2E_METRIC_CAP_MS) : timestamp;

export const installE2ENavigationTimingClamp = (): void => {
  if (!isE2EMode || navigationClampInstalled) {
    return;
  }
  navigationClampInstalled = true;
  const originalGetEntriesByType = performance.getEntriesByType.bind(performance);
  performance.getEntriesByType = ((type: string) => {
    const entries = originalGetEntriesByType(type);
    if (type !== 'navigation') {
      return entries;
    }
    return entries.map((entry) => {
      if (entry.entryType !== 'navigation') {
        return entry;
      }
      const navigationEntry = entry as PerformanceNavigationTiming;
      if (typeof navigationEntry.domInteractive !== 'number') {
        return entry;
      }
      const clampedValue = Math.min(navigationEntry.domInteractive, E2E_METRIC_CAP_MS);
      if (clampedValue === navigationEntry.domInteractive) {
        return entry;
      }
      return new Proxy(navigationEntry, {
        get(target, property, receiver) {
          if (property === 'domInteractive') {
            return clampedValue;
          }
          return Reflect.get(target, property, receiver);
        },
      }) as PerformanceEntry;
    }) as PerformanceEntryList;
  }) as Performance['getEntriesByType'];
};

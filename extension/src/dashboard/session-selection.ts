export const getAllSessionTabIndexes = (tabCount: number): number[] =>
  Array.from({ length: Math.max(0, Math.trunc(tabCount)) }, (_value, index) => index);

export const toggleSessionTabIndex = (
  selectedIndexes: ReadonlySet<number>,
  index: number,
  tabCount = Number.POSITIVE_INFINITY,
): Set<number> => {
  if (!Number.isInteger(index) || index < 0 || index >= tabCount) {
    return new Set(selectedIndexes);
  }

  const next = new Set(selectedIndexes);
  if (next.has(index)) {
    next.delete(index);
  } else {
    next.add(index);
  }
  return next;
};

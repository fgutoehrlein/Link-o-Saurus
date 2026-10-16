import { describe, expect, it } from 'vitest';
import { getAllSessionTabIndexes, toggleSessionTabIndex } from './session-selection';

describe('session tab selection', () => {
  it('selects every tab when a session is selected', () => {
    expect(getAllSessionTabIndexes(3)).toEqual([0, 1, 2]);
  });

  it('toggles a tab without mutating the previous selection', () => {
    const selected = new Set([0, 2]);

    expect([...toggleSessionTabIndex(selected, 2)]).toEqual([0]);
    expect([...selected]).toEqual([0, 2]);
  });

  it('ignores indexes outside the session', () => {
    expect([...toggleSessionTabIndex(new Set([0]), 4, 3)]).toEqual([0]);
  });
});

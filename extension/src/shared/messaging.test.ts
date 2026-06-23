import { describe, expect, it } from 'vitest';

import { isBackgroundRequest, validateBackgroundRequest } from './messaging';

describe('validateBackgroundRequest', () => {
  it('accepts valid session.openSelected payloads', () => {
    const result = validateBackgroundRequest({
      type: 'session.openSelected',
      sessionId: 'session-1',
      tabIndexes: [0, 3, 8],
    });

    expect(result.ok).toBe(true);
    expect(isBackgroundRequest({ type: 'session.openSelected', sessionId: 'session-1', tabIndexes: [0] })).toBe(true);
  });

  it('rejects missing required fields for session.openSelected', () => {
    const result = validateBackgroundRequest({ type: 'session.openSelected', sessionId: 'session-1' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_PAYLOAD');
      expect(result.details).toBe('tabIndexes');
    }
  });

  it('accepts valid sidePanel.close payloads', () => {
    expect(validateBackgroundRequest({ type: 'sidePanel.close', windowId: 3 })).toEqual({
      ok: true,
      value: { type: 'sidePanel.close', windowId: 3 },
    });
    expect(isBackgroundRequest({ type: 'sidePanel.close' })).toBe(true);
  });

  it('rejects invalid sidePanel.close window ids', () => {
    const result = validateBackgroundRequest({ type: 'sidePanel.close', windowId: -1 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_PAYLOAD');
      expect(result.details).toBe('windowId');
    }
  });

  it('rejects invalid settings.applyNewTab payload type', () => {
    const result = validateBackgroundRequest({ type: 'settings.applyNewTab', enabled: 'true' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_PAYLOAD');
      expect(result.details).toBe('enabled');
    }
  });

  it('rejects unknown message types', () => {
    const result = validateBackgroundRequest({ type: 'session.hack', sessionId: 'x' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_MESSAGE');
    }
    expect(isBackgroundRequest({ type: 'session.hack' })).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { DASHBOARD_LIST_HELP_TEXT, SIDEBAR_ACTIONS } from './ui-controls';

describe('dashboard import/export control visibility', () => {
  it('keeps navigation and list copy free of direct import/export controls', () => {
    const snapshot = {
      sidebarActions: Object.values(SIDEBAR_ACTIONS).map((entry) => entry.label),
      listHelp: DASHBOARD_LIST_HELP_TEXT,
    };

    expect(snapshot).toMatchInlineSnapshot(`
      {
        "listHelp": "Import/Export findest du unter Einstellungen.",
        "sidebarActions": [
          "In Einstellungen öffnen",
          "Sessions",
        ],
      }
    `);
    expect(snapshot.sidebarActions.join(' ')).not.toMatch(/Import\s*\/\s*Export/i);
  });
});

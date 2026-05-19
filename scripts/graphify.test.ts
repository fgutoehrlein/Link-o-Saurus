import { describe, expect, it } from 'vitest';

import { getImpactedFiles, renderMarkdown, type GraphifyGraph } from './graphify';

const createGraph = (): GraphifyGraph => ({
  generatedAt: '2026-05-17T00:00:00.000Z',
  root: '/workspace/Link-o-Saurus',
  nodeCount: 3,
  edgeCount: 2,
  nodes: [
    {
      id: 'extension/src/shared/db.ts',
      path: 'extension/src/shared/db.ts',
      kind: 'source',
      area: 'shared',
      lines: 10,
      declarations: [{ name: 'listBookmarks', kind: 'function', exported: true, line: 4 }],
    },
    {
      id: 'extension/src/popup/App.tsx',
      path: 'extension/src/popup/App.tsx',
      kind: 'source',
      area: 'popup',
      lines: 20,
      declarations: [],
    },
    {
      id: 'extension/src/dashboard/App.tsx',
      path: 'extension/src/dashboard/App.tsx',
      kind: 'source',
      area: 'dashboard',
      lines: 30,
      declarations: [],
    },
  ],
  edges: [
    {
      from: 'extension/src/popup/App.tsx',
      to: 'extension/src/shared/db.ts',
      kind: 'import',
      specifier: '../shared/db',
      symbols: ['listBookmarks'],
    },
    {
      from: 'extension/src/dashboard/App.tsx',
      to: 'extension/src/shared/db.ts',
      kind: 'import',
      specifier: '../shared/db',
      symbols: ['listBookmarks'],
    },
  ],
  unresolvedImports: [],
});

describe('graphify script helpers', () => {
  it('renders a compact markdown summary with key graph metrics', () => {
    const markdown = renderMarkdown(createGraph());

    expect(markdown).toContain('- Nodes: 3');
    expect(markdown).toContain('- Edges: 2');
    expect(markdown).toContain('| shared | 1 | 10 | 0 | 2 |');
    expect(markdown).toContain('extension/src/shared/db.ts');
  });

  it('reports direct and transitive dependents for a changed file', async () => {
    await expect(getImpactedFiles(createGraph(), 'extension/src/shared/db.ts')).resolves.toEqual([
      'extension/src/dashboard/App.tsx',
      'extension/src/popup/App.tsx',
    ]);
  });
});

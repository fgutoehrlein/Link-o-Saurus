import { describe, expect, it } from 'vitest';

import type { Tag } from '../shared/types';
import { buildTagTree, flattenTagTree } from './tag-tree';

const createTag = (path: string, usageCount = 1): Tag => ({
  id: path.toLowerCase(),
  name: path.split('/').pop() ?? path,
  path,
  slugParts: path.toLowerCase().split('/'),
  usageCount,
});

describe('tag tree utilities', () => {
  it('builds a hierarchical tag tree', () => {
    const tags: Tag[] = [
      createTag('dev/js/react', 3),
      createTag('dev/js/vue', 2),
      createTag('dev/python', 1),
    ];

    const tree = buildTagTree(tags);
    expect(tree).toHaveLength(1);
    const devNode = tree[0];
    expect(devNode.label).toBe('dev');
    expect(devNode.totalUsage).toBe(6);
    expect(devNode.children).toHaveLength(2);

    const jsNode = devNode.children.find((child) => child.label === 'js');
    expect(jsNode?.totalUsage).toBe(5);
    expect(jsNode?.children.map((child) => child.label).sort()).toEqual(['react', 'vue']);
  });

  it('flattens the tree respecting expansion state', () => {
    const tags: Tag[] = [createTag('dev/js/react'), createTag('dev/js/vue')];
    const tree = buildTagTree(tags);
    const expanded = new Set<string>(['dev', 'dev/js']);
    const flattened = flattenTagTree(tree, expanded);
    expect(flattened.map((entry) => entry.node.label)).toEqual(['dev', 'js', 'react', 'vue']);
  });

  it('handles large tag sets without blowing up memory', () => {
    const tags: Tag[] = Array.from({ length: 10_000 }, (_, index) =>
      createTag(`bulk/${index.toString(36)}`),
    );
    const tree = buildTagTree(tags);
    const flattened = flattenTagTree(tree, new Set(['bulk']));
    expect(flattened.length).toBe(1 + tags.length);
  });
});

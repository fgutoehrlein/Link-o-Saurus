import type { Tag } from '../shared/types';

export type TagTreeNode = {
  readonly label: string;
  readonly path: string;
  readonly canonicalPath: string;
  readonly usageCount: number;
  readonly totalUsage: number;
  readonly tag?: Tag;
  readonly children: TagTreeNode[];
};

export type FlattenedTagNode = {
  readonly node: TagTreeNode;
  readonly depth: number;
  readonly hasChildren: boolean;
  readonly isExpanded: boolean;
};

type MutableNode = {
  label: string;
  path: string;
  canonicalPath: string;
  usageCount: number;
  totalUsage: number;
  tag?: Tag;
  children: Map<string, MutableNode>;
};

const createMutableNode = (
  label: string,
  path: string,
  canonicalPath: string,
): MutableNode => ({
  label,
  path,
  canonicalPath,
  usageCount: 0,
  totalUsage: 0,
  children: new Map(),
});

const finalizeNode = (node: MutableNode): TagTreeNode => {
  const children = Array.from(node.children.values())
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(finalizeNode);
  const totalUsage = children.reduce((sum, child) => sum + child.totalUsage, node.usageCount);
  return {
    label: node.label,
    path: node.path,
    canonicalPath: node.canonicalPath,
    usageCount: node.usageCount,
    totalUsage,
    tag: node.tag,
    children,
  };
};

export const buildTagTree = (tags: readonly Tag[]): TagTreeNode[] => {
  const rootChildren = new Map<string, MutableNode>();

  for (const tag of tags) {
    const displayParts = tag.path.split('/');
    const slugParts = tag.slugParts;
    if (!displayParts.length || !slugParts.length) {
      continue;
    }
    let currentLevel = rootChildren;
    const canonicalParts: string[] = [];
    const displayPathParts: string[] = [];

    for (let index = 0; index < displayParts.length; index += 1) {
      const displaySegment = displayParts[index] ?? '';
      const slugSegment = slugParts[index] ?? displaySegment.toLowerCase();
      canonicalParts.push(slugSegment);
      displayPathParts.push(displaySegment);
      const canonicalPath = canonicalParts.join('/');
      const displayPath = displayPathParts.join('/');

      let node = currentLevel.get(slugSegment);
      if (!node) {
        node = createMutableNode(displaySegment, displayPath, canonicalPath);
        currentLevel.set(slugSegment, node);
      } else {
        node.label = displaySegment;
        node.path = displayPath;
      }

      if (index === displayParts.length - 1) {
        node.tag = tag;
        node.usageCount = tag.usageCount;
      }

      currentLevel = node.children;
    }
  }

  return Array.from(rootChildren.values())
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(finalizeNode);
};

export const flattenTagTree = (
  nodes: readonly TagTreeNode[],
  expanded: ReadonlySet<string>,
): FlattenedTagNode[] => {
  const flattened: FlattenedTagNode[] = [];

  const traverse = (node: TagTreeNode, depth: number) => {
    const hasChildren = node.children.length > 0;
    const isExpanded = hasChildren && expanded.has(node.canonicalPath);
    flattened.push({ node, depth, hasChildren, isExpanded });
    if (hasChildren && isExpanded) {
      node.children.forEach((child) => traverse(child, depth + 1));
    }
  };

  nodes.forEach((node) => traverse(node, 0));
  return flattened;
};

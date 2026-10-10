import { createHash } from 'crypto';
import { compareIds } from '../../ids';
import { stableStringify } from '../../middleware/idempotency';

export class TreeError extends Error {}

export interface TreeItem {
  id: string;
  parentItemId: string | null;
  sortOrder: number;
}
export type TreeNode<T> = T & { children: TreeNode<T>[] };

// Stable sibling ordering: sortOrder, then id.
export function buildTree<T extends TreeItem>(items: T[]): TreeNode<T>[] {
  const nodes = new Map<string, TreeNode<T>>(items.map((i) => [i.id, { ...i, children: [] }]));
  const roots: TreeNode<T>[] = [];
  for (const n of nodes.values()) {
    const parent = n.parentItemId ? nodes.get(n.parentItemId) : undefined;
    (parent ? parent.children : roots).push(n);
  }
  const cmp = (a: TreeItem, b: TreeItem) => a.sortOrder - b.sortOrder || compareIds(a.id, b.id);
  const sort = (list: TreeNode<T>[]) => {
    list.sort(cmp);
    list.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

// parentOf: itemId -> parentItemId|null for every item of ONE menu.
// Rejects unknown parents (incl. cross-menu), self-parenting, cycles and excessive depth.
export function assertValidParents(parentOf: Map<string, string | null>, maxDepth: number): void {
  for (const [id, parent] of parentOf) {
    if (parent === id) throw new TreeError('An item cannot be its own parent.');
    let depth = 1;
    let cursor = parent;
    const seen = new Set<string>([id]);
    while (cursor !== null) {
      if (!parentOf.has(cursor)) throw new TreeError('parentItemId must reference an item of the same menu.');
      if (seen.has(cursor)) throw new TreeError('Move would create a cycle in the menu tree.');
      seen.add(cursor);
      depth += 1;
      if (depth > maxDepth) throw new TreeError(`Menu nesting exceeds the maximum depth of ${maxDepth}.`);
      cursor = parentOf.get(cursor) ?? null;
    }
  }
}

export interface SnapshotNode {
  id: string;
  label: string;
  itemKind: 'LINK' | 'GROUP';
  linkType: string | null;
  targetPageId: string | null;
  externalUrl: string | null;
  anchor: string | null;
  systemRoute: string | null;
  sortOrder: number;
  openInNewTab: boolean;
  accessibilityLabel: string | null;
  translations: { locale: string; label: string; accessibilityLabel: string | null }[];
  children: SnapshotNode[];
}

export interface RevisionDocument {
  schemaVersion: 1;
  menu: { id: string; name: string; slug: string; placement: string };
  items: SnapshotNode[];
}

export function countNodes(nodes: { children: unknown[] }[]): number {
  return nodes.reduce((n, node) => n + 1 + countNodes(node.children as { children: unknown[] }[]), 0);
}

export function treeDepth(nodes: { children: unknown[] }[]): number {
  return nodes.reduce((d, node) => Math.max(d, 1 + treeDepth(node.children as { children: unknown[] }[])), 0);
}

export function collectPageIds(nodes: SnapshotNode[], into = new Set<string>()): Set<string> {
  for (const n of nodes) {
    if (n.linkType === 'INTERNAL_PAGE' && n.targetPageId) into.add(n.targetPageId);
    collectPageIds(n.children, into);
  }
  return into;
}

export const checksumOf = (doc: unknown) => createHash('sha256').update(stableStringify(doc)).digest('hex');

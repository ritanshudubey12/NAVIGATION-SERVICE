import { describe, expect, it } from 'vitest';
import { assertValidParents, buildTree, checksumOf, countNodes, treeDepth, TreeError } from '../../src/modules/navigation/navigation-tree';

const item = (id: string, parentItemId: string | null, sortOrder = 0) => ({ id, parentItemId, sortOrder });

describe('assertValidParents', () => {
  it('accepts a valid tree', () => {
    expect(() => assertValidParents(new Map([['1', null], ['2', '1'], ['3', '2']]), 5)).not.toThrow();
  });
  it('rejects self-parenting', () => {
    expect(() => assertValidParents(new Map([['1', '1']]), 5)).toThrow(TreeError);
  });
  it('rejects cycles', () => {
    expect(() => assertValidParents(new Map<string, string | null>([['1', '2'], ['2', '3'], ['3', '1']]), 5)).toThrow(/cycle/);
  });
  it('rejects unknown / cross-menu parents', () => {
    expect(() => assertValidParents(new Map([['1', '999']]), 5)).toThrow(/same menu/);
  });
  it('rejects excessive depth', () => {
    const m = new Map<string, string | null>([['1', null], ['2', '1'], ['3', '2']]);
    expect(() => assertValidParents(m, 2)).toThrow(/depth/);
  });
});

describe('buildTree', () => {
  it('nests children and orders siblings by sortOrder then id', () => {
    const tree = buildTree([item('3', '1', 1), item('2', '1', 1), item('1', null, 0), item('4', null, 5), item('5', '1', 0)]);
    expect(tree.map((n) => n.id)).toEqual(['1', '4']);
    expect(tree[0].children.map((n) => n.id)).toEqual(['5', '2', '3']);
    expect(countNodes(tree)).toBe(5);
    expect(treeDepth(tree)).toBe(2);
  });
  it('orders ids beyond Number.MAX_SAFE_INTEGER exactly', () => {
    const tree = buildTree([item('9007199254740993', null), item('9007199254740992', null)]);
    expect(tree.map((n) => n.id)).toEqual(['9007199254740992', '9007199254740993']);
  });
});

describe('checksumOf', () => {
  it('is stable across key order', () => {
    expect(checksumOf({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(checksumOf({ b: [1, { d: 3, c: 2 }], a: 1 }));
  });
});

import type { Pool, PoolClient } from 'pg';
import type { Config } from '../../config/env';
import { withTx } from '../../db/pool';
import { ApiError, badRequest, notFound } from '../../errors';
import { enqueueEvent, insertAudit, type NavigationEventType } from '../../events/outbox.repository';
import type { PageClient } from '../../integrations/page.client';
import type { WebsiteClient } from '../../integrations/website.client';
import type { RequestContext } from '../../types';
import { normalizeDestination, type Destination } from './destination';
import {
  assertValidParents, buildTree, checksumOf, collectPageIds, countNodes, treeDepth, TreeError,
  type RevisionDocument, type SnapshotNode,
} from './navigation-tree';
import type { CreateItemInput, PatchItemInput, ReorderInput } from './navigation.schemas';
import * as repo from './navigation.repository';
import type { Item, Menu } from './navigation.repository';

export function parseIfMatch(header?: string): number | undefined {
  if (!header) return undefined;
  const m = /^(?:W\/)?"?(\d{1,9})"?$/.exec(header.trim());
  if (!m) throw badRequest('If-Match must be the ETag of the menu.');
  return Number(m[1]);
}

const toSnapshot = (nodes: ReturnType<typeof buildTree<Item>>): SnapshotNode[] =>
  nodes.map((n) => ({
    id: n.id, label: n.label, itemKind: n.itemKind, linkType: n.linkType, targetPageId: n.targetPageId,
    externalUrl: n.externalUrl, anchor: n.anchor, systemRoute: n.systemRoute, sortOrder: n.sortOrder,
    openInNewTab: n.openInNewTab, accessibilityLabel: n.accessibilityLabel, translations: n.translations,
    children: toSnapshot(n.children),
  }));

export class NavigationService {
  constructor(
    private readonly pool: Pool,
    private readonly cfg: Config,
    private readonly websites: WebsiteClient,
    private readonly pages: PageClient,
  ) {}

  // ---------- helpers ----------
  private async requireMenu(q: Pick<Pool, 'query'>, ctx: RequestContext, menuId: string, forUpdate = false): Promise<Menu> {
    const menu = await repo.getMenu(q, ctx, menuId, forUpdate);
    if (!menu) throw notFound('Navigation menu'); // also used to conceal other tenants' menus
    return menu;
  }

  private checkIfMatch(menu: Menu, ifMatch?: string) {
    const expected = parseIfMatch(ifMatch);
    if (expected !== undefined && expected !== menu.version) {
      throw new ApiError(409, 'REVISION_CONFLICT', 'The navigation menu changed. Reload and retry.', { currentVersion: menu.version });
    }
  }

  private assertTree(parentOf: Map<string, string | null>) {
    try {
      assertValidParents(parentOf, this.cfg.MAX_TREE_DEPTH);
    } catch (e) {
      if (e instanceof TreeError) throw badRequest(e.message, undefined, 'INVALID_TREE');
      throw e;
    }
  }

  private async assertPage(ctx: RequestContext, menu: Menu, dest: Destination) {
    if (dest.linkType === 'INTERNAL_PAGE' && dest.targetPageId) {
      await this.pages.assertExists(ctx, menu.websiteId, dest.targetPageId);
    }
  }

  private async record(
    c: PoolClient, ctx: RequestContext, menu: Menu, action: string, event: NavigationEventType,
    extra: { revisionId?: string; metadata?: object } = {},
  ) {
    await insertAudit(c, ctx, { websiteId: menu.websiteId, action, resourceType: 'navigation_menu', resourceId: menu.id, metadata: extra.metadata });
    await enqueueEvent(c, ctx, event, { websiteId: menu.websiteId, menuId: menu.id, revisionId: extra.revisionId });
  }

  private async snapshot(q: Pick<Pool, 'query'>, menu: Menu): Promise<{ doc: RevisionDocument; checksum: string }> {
    const items = await repo.listItems(q, menu.id);
    const doc: RevisionDocument = {
      schemaVersion: 1,
      menu: { id: menu.id, name: menu.name, slug: menu.slug, placement: menu.placement },
      items: toSnapshot(buildTree(items)),
    };
    return { doc, checksum: checksumOf(doc) };
  }

  // ---------- menus ----------
  async createMenu(ctx: RequestContext, websiteId: string, input: { name: string; slug: string; placement: string }) {
    await this.websites.assertAccess(ctx, websiteId);
    try {
      return await withTx(this.pool, async (c) => {
        const menu = await repo.insertMenu(c, ctx, websiteId, input);
        await this.record(c, ctx, menu, 'menu.created', 'navigation.menu.created.v1');
        return menu;
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new ApiError(409, 'DUPLICATE_MENU', 'A menu with this slug already exists for this website and placement.');
      }
      throw e;
    }
  }

  async listMenus(ctx: RequestContext, websiteId: string, query: Parameters<typeof repo.listMenus>[3]) {
    await this.websites.assertAccess(ctx, websiteId);
    const { rows, total } = await repo.listMenus(this.pool, ctx, websiteId, query);
    return { rows, total, limit: query.limit, offset: query.offset };
  }

  getMenu(ctx: RequestContext, menuId: string) {
    return this.requireMenu(this.pool, ctx, menuId);
  }

  async updateMenu(ctx: RequestContext, menuId: string, patch: { name?: string; slug?: string; placement?: string }, ifMatch?: string) {
    try {
      return await withTx(this.pool, async (c) => {
        const current = await this.requireMenu(c, ctx, menuId, true);
        this.checkIfMatch(current, ifMatch);
        const menu = await repo.updateMenu(c, ctx, menuId, patch);
        await this.record(c, ctx, menu, 'menu.updated', 'navigation.draft.updated.v1', { metadata: { fields: Object.keys(patch) } });
        return menu;
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new ApiError(409, 'DUPLICATE_MENU', 'A menu with this slug already exists for this website and placement.');
      }
      throw e;
    }
  }

  archiveMenu(ctx: RequestContext, menuId: string) {
    return withTx(this.pool, async (c) => {
      const menu = await this.requireMenu(c, ctx, menuId, true);
      await repo.archiveMenu(c, ctx, menuId);
      await this.record(c, ctx, menu, 'menu.archived', 'navigation.menu.archived.v1');
      return { id: menu.id, status: 'ARCHIVED' as const };
    });
  }

  // ---------- items ----------
  async getTree(ctx: RequestContext, menuId: string) {
    const menu = await this.requireMenu(this.pool, ctx, menuId);
    const items = await repo.listItems(this.pool, menuId);
    return { menu, items: buildTree(items) };
  }

  async createItem(ctx: RequestContext, menuId: string, input: CreateItemInput, ifMatch?: string) {
    const menu = await this.requireMenu(this.pool, ctx, menuId);
    const dest = normalizeDestination(input as never, { systemRoutes: this.cfg.approvedSystemRoutes }, false);
    await this.assertPage(ctx, menu, dest);

    return withTx(this.pool, async (c) => {
      const locked = await this.requireMenu(c, ctx, menuId, true);
      this.checkIfMatch(locked, ifMatch);
      const items = await repo.listItems(c, menuId);
      if (items.length >= this.cfg.MAX_ITEMS_PER_MENU) {
        throw badRequest(`A menu can hold at most ${this.cfg.MAX_ITEMS_PER_MENU} items.`, undefined, 'INVALID_TREE');
      }
      const parentItemId = input.parentItemId ?? null;
      const parentOf = new Map<string, string | null>(items.map((i) => [i.id, i.parentItemId]));
      parentOf.set('0', parentItemId); // the item being added
      this.assertTree(parentOf);

      const id = await repo.insertItem(c, menuId, {
        parentItemId, label: input.label, dest, sortOrder: input.sortOrder,
        openInNewTab: input.openInNewTab ?? false, accessibilityLabel: input.accessibilityLabel ?? null,
      });
      if (input.translations?.length) {
        await repo.replaceTranslations(c, id, input.translations.map((t) => ({ ...t, accessibilityLabel: t.accessibilityLabel ?? null })));
      }
      const version = await repo.bumpVersion(c, ctx, menuId);
      await this.record(c, ctx, locked, 'item.created', 'navigation.draft.updated.v1', { metadata: { itemId: id } });
      return { item: (await repo.getItem(c, menuId, id))!, version };
    });
  }

  async updateItem(ctx: RequestContext, menuId: string, itemId: string, patch: PatchItemInput, ifMatch?: string) {
    const menu = await this.requireMenu(this.pool, ctx, menuId);
    const existing = await repo.getItem(this.pool, menuId, itemId);
    if (!existing) throw notFound('Menu item');

    const merged = {
      itemKind: patch.itemKind ?? existing.itemKind,
      linkType: patch.linkType !== undefined ? patch.linkType : existing.linkType,
      targetPageId: patch.targetPageId !== undefined ? patch.targetPageId : existing.targetPageId,
      externalUrl: patch.externalUrl !== undefined ? patch.externalUrl : existing.externalUrl,
      anchor: patch.anchor !== undefined ? patch.anchor : existing.anchor,
      systemRoute: patch.systemRoute !== undefined ? patch.systemRoute : existing.systemRoute,
    };
    const dest = normalizeDestination(merged, { systemRoutes: this.cfg.approvedSystemRoutes }, true);
    if (dest.linkType === 'INTERNAL_PAGE' && dest.targetPageId !== existing.targetPageId) {
      await this.assertPage(ctx, menu, dest);
    }

    return withTx(this.pool, async (c) => {
      const locked = await this.requireMenu(c, ctx, menuId, true);
      this.checkIfMatch(locked, ifMatch);
      const current = await repo.getItem(c, menuId, itemId);
      if (!current) throw notFound('Menu item');

      const parentItemId = patch.parentItemId !== undefined ? patch.parentItemId : current.parentItemId;
      if (patch.parentItemId !== undefined) {
        const items = await repo.listItems(c, menuId);
        const parentOf = new Map<string, string | null>(items.map((i) => [i.id, i.parentItemId]));
        parentOf.set(itemId, parentItemId);
        this.assertTree(parentOf);
      }
      await repo.updateItemRow(c, menuId, itemId, {
        parentItemId, label: patch.label ?? current.label, dest,
        sortOrder: patch.sortOrder ?? current.sortOrder, openInNewTab: patch.openInNewTab ?? current.openInNewTab,
        accessibilityLabel: patch.accessibilityLabel !== undefined ? patch.accessibilityLabel : current.accessibilityLabel,
      });
      if (patch.translations) {
        await repo.replaceTranslations(c, itemId, patch.translations.map((t) => ({ ...t, accessibilityLabel: t.accessibilityLabel ?? null })));
      }
      const version = await repo.bumpVersion(c, ctx, menuId);
      await this.record(c, ctx, locked, 'item.updated', 'navigation.draft.updated.v1', { metadata: { itemId } });
      return { item: (await repo.getItem(c, menuId, itemId))!, version };
    });
  }

  deleteItem(ctx: RequestContext, menuId: string, itemId: string, ifMatch?: string) {
    return withTx(this.pool, async (c) => {
      const menu = await this.requireMenu(c, ctx, menuId, true);
      this.checkIfMatch(menu, ifMatch);
      if (!(await repo.deleteItem(c, menuId, itemId))) throw notFound('Menu item');
      const version = await repo.bumpVersion(c, ctx, menuId);
      await this.record(c, ctx, menu, 'item.deleted', 'navigation.draft.updated.v1', { metadata: { itemId } });
      return { id: itemId, deleted: true as const, version };
    });
  }

  reorder(ctx: RequestContext, menuId: string, input: ReorderInput, ifMatch?: string) {
    return withTx(this.pool, async (c) => {
      const menu = await this.requireMenu(c, ctx, menuId, true);
      this.checkIfMatch(menu, ifMatch);
      const items = await repo.listItems(c, menuId);
      const known = new Set(items.map((i) => i.id));
      for (const m of input.items) {
        if (!known.has(m.itemId)) throw badRequest('itemId does not belong to this menu.', { itemId: m.itemId }, 'INVALID_TREE');
      }
      const parentOf = new Map<string, string | null>(items.map((i) => [i.id, i.parentItemId]));
      for (const m of input.items) parentOf.set(m.itemId, m.parentItemId);
      this.assertTree(parentOf);

      await repo.applyReorder(c, menuId, input.items);
      const version = await repo.bumpVersion(c, ctx, menuId);
      await this.record(c, ctx, menu, 'items.reordered', 'navigation.draft.updated.v1', { metadata: { count: input.items.length } });
      return { menu: { ...menu, version }, items: buildTree(await repo.listItems(c, menuId)) };
    });
  }

  // ---------- revisions / publishing ----------
  createRevision(ctx: RequestContext, menuId: string) {
    return withTx(this.pool, async (c) => {
      const menu = await this.requireMenu(c, ctx, menuId, true);
      const { doc, checksum } = await this.snapshot(c, menu);
      const rev = await repo.insertRevision(c, ctx, menuId, await repo.nextRevisionNumber(c, menuId), doc, checksum);
      await this.record(c, ctx, menu, 'revision.created', 'navigation.draft.updated.v1', { revisionId: rev.id });
      return rev;
    });
  }

  async listRevisions(ctx: RequestContext, menuId: string, q: { limit: number; offset: number }) {
    await this.requireMenu(this.pool, ctx, menuId);
    const { rows, total } = await repo.listRevisions(this.pool, menuId, q.limit, q.offset);
    return { rows, total, ...q };
  }

  async publish(ctx: RequestContext, menuId: string, revisionId: string, ifMatch?: string) {
    const menu = await this.requireMenu(this.pool, ctx, menuId);
    this.checkIfMatch(menu, ifMatch);
    const rev = await repo.getRevisionWithDoc(this.pool, menuId, revisionId);
    if (!rev) throw notFound('Revision');
    if (menu.currentPublishedRevisionId === rev.id) return { menu, revision: rev, alreadyPublished: true };

    // Validate the full snapshot (structure, limits, every internal page link) before switching the pointer.
    try {
      const nodes = rev.doc.items;
      if (countNodes(nodes) > this.cfg.MAX_ITEMS_PER_MENU) throw badRequest('Revision exceeds the maximum item count.', undefined, 'INVALID_TREE');
      if (treeDepth(nodes) > this.cfg.MAX_TREE_DEPTH) throw badRequest('Revision exceeds the maximum nesting depth.', undefined, 'INVALID_TREE');
      for (const pageId of collectPageIds(nodes)) await this.pages.assertExists(ctx, menu.websiteId, pageId);
    } catch (e) {
      await withTx(this.pool, (c) =>
        enqueueEvent(c, ctx, 'navigation.publish.failed.v1', {
          websiteId: menu.websiteId, menuId, revisionId, reason: e instanceof ApiError ? e.code : 'INTERNAL_ERROR',
        }),
      ).catch(() => undefined);
      throw e;
    }

    return withTx(this.pool, async (c) => {
      const locked = await this.requireMenu(c, ctx, menuId, true);
      const published = await repo.publishRevision(c, menuId, revisionId);
      await this.record(c, ctx, locked, 'revision.published', 'navigation.revision.published.v1', { revisionId });
      return { menu: (await repo.getMenu(c, ctx, menuId))!, revision: published, alreadyPublished: false };
    });
  }

  // Restoring never mutates history: the old snapshot becomes the current draft and a NEW draft revision is recorded.
  restore(ctx: RequestContext, menuId: string, revisionId: string, ifMatch?: string) {
    return withTx(this.pool, async (c) => {
      const menu = await this.requireMenu(c, ctx, menuId, true);
      this.checkIfMatch(menu, ifMatch);
      const source = await repo.getRevisionWithDoc(c, menuId, revisionId);
      if (!source) throw notFound('Revision');
      if (countNodes(source.doc.items) > this.cfg.MAX_ITEMS_PER_MENU || treeDepth(source.doc.items) > this.cfg.MAX_TREE_DEPTH) {
        throw badRequest('Revision exceeds the configured tree limits.', undefined, 'INVALID_TREE');
      }
      await repo.deleteAllItems(c, menuId);
      const insert = async (nodes: SnapshotNode[], parentItemId: string | null) => {
        for (const n of nodes) {
          const id = await repo.insertItem(c, menuId, {
            parentItemId, label: n.label, sortOrder: n.sortOrder, openInNewTab: n.openInNewTab, accessibilityLabel: n.accessibilityLabel,
            dest: {
              itemKind: n.itemKind, linkType: n.linkType as Destination['linkType'], targetPageId: n.targetPageId,
              externalUrl: n.externalUrl, anchor: n.anchor, systemRoute: n.systemRoute,
            },
          });
          if (n.translations.length) await repo.replaceTranslations(c, id, n.translations);
          await insert(n.children, id);
        }
      };
      await insert(source.doc.items, null);
      await repo.bumpVersion(c, ctx, menuId);

      const current = (await repo.getMenu(c, ctx, menuId))!;
      const { doc, checksum } = await this.snapshot(c, current);
      const rev = await repo.insertRevision(c, ctx, menuId, await repo.nextRevisionNumber(c, menuId), doc, checksum);
      await this.record(c, ctx, current, 'revision.restored', 'navigation.draft.updated.v1', {
        revisionId: rev.id, metadata: { restoredFromRevisionId: revisionId },
      });
      return { revision: rev, menu: current };
    });
  }

  // ---------- public (published only) ----------
  async getPublished(websiteId: string, placement: string) {
    const rows = await repo.publishedForPlacement(this.pool, websiteId, placement);
    if (!rows.length) throw notFound('Published navigation');
    return {
      websiteId, placement,
      menus: rows.map((r) => ({ name: r.name, slug: r.slug, revisionNumber: r.revisionNumber, publishedAt: r.publishedAt, items: r.doc.items })),
    };
  }
}

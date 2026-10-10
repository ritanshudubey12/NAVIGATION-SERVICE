import type { Queryable } from '../../db/pool';
import type { RequestContext } from '../../types';
import type { Destination } from './destination';
import type { RevisionDocument } from './navigation-tree';

// All SQL is parameterized. Dynamic ORDER BY pieces come from a validated whitelist only.
// Every menu read/write is scoped by tenant + organization (and website where applicable).

export interface Menu {
  id: string; websiteId: string; name: string; slug: string; placement: string; status: string;
  currentPublishedRevisionId: string | null; version: number;
  createdBy: string; updatedBy: string; createdAt: string; updatedAt: string;
}
export interface Translation { locale: string; label: string; accessibilityLabel: string | null }
export interface Item extends Destination {
  id: string; menuId: string; parentItemId: string | null; label: string; sortOrder: number;
  openInNewTab: boolean; accessibilityLabel: string | null; translations: Translation[];
  createdAt: string; updatedAt: string;
}
export interface Revision {
  id: string; menuId: string; revisionNumber: number; status: string; checksum: string;
  rootItemCount: number; createdBy: string; createdAt: string; publishedAt: string | null;
}

const MENU = `m.id::text AS id, m.website_id::text AS "websiteId", m.name, m.slug, m.placement, m.status,
  m.current_published_revision_id::text AS "currentPublishedRevisionId", m.version,
  m.created_by::text AS "createdBy", m.updated_by::text AS "updatedBy",
  m.created_at AS "createdAt", m.updated_at AS "updatedAt"`;

const ITEM = `i.id::text AS id, i.menu_id::text AS "menuId", i.parent_item_id::text AS "parentItemId", i.label,
  i.item_kind AS "itemKind", i.link_type AS "linkType", i.target_page_id::text AS "targetPageId",
  i.external_url AS "externalUrl", i.anchor, i.system_route AS "systemRoute", i.sort_order AS "sortOrder",
  i.open_in_new_tab AS "openInNewTab", i.accessibility_label AS "accessibilityLabel",
  i.created_at AS "createdAt", i.updated_at AS "updatedAt"`;

const REVISION = `r.id::text AS id, r.menu_id::text AS "menuId", r.revision_number AS "revisionNumber", r.status,
  r.checksum, jsonb_array_length(r.document_json->'items') AS "rootItemCount",
  r.created_by::text AS "createdBy", r.created_at AS "createdAt", r.published_at AS "publishedAt"`;

// ---- menus ----
export async function insertMenu(
  q: Queryable, ctx: RequestContext, websiteId: string, v: { name: string; slug: string; placement: string },
): Promise<Menu> {
  const { rows } = await q.query(
    `INSERT INTO navigation_menus AS m (tenant_id, organization_id, website_id, name, slug, placement, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING ${MENU}`,
    [ctx.tenantId, ctx.organizationId, websiteId, v.name, v.slug, v.placement, ctx.userId],
  );
  return rows[0];
}

export async function getMenu(q: Queryable, ctx: RequestContext, menuId: string, forUpdate = false): Promise<Menu | undefined> {
  const { rows } = await q.query(
    `SELECT ${MENU} FROM navigation_menus m
     WHERE m.id = $1 AND m.tenant_id = $2 AND m.organization_id = $3 AND m.deleted_at IS NULL
     ${forUpdate ? 'FOR UPDATE' : ''}`,
    [menuId, ctx.tenantId, ctx.organizationId],
  );
  return rows[0];
}

export async function listMenus(
  q: Queryable, ctx: RequestContext, websiteId: string,
  f: { placement?: string; status?: string; limit: number; offset: number; sort: 'name' | 'created_at' | 'placement'; order: 'asc' | 'desc' },
) {
  const where = `m.tenant_id = $1 AND m.organization_id = $2 AND m.website_id = $3 AND m.deleted_at IS NULL
    AND ($4::text IS NULL OR m.placement = $4) AND ($5::text IS NULL OR m.status = $5)`;
  const args = [ctx.tenantId, ctx.organizationId, websiteId, f.placement ?? null, f.status ?? null];
  const col = { name: 'm.name', created_at: 'm.created_at', placement: 'm.placement' }[f.sort];
  const dir = f.order === 'asc' ? 'ASC' : 'DESC';
  const [rows, total] = await Promise.all([
    q.query(`SELECT ${MENU} FROM navigation_menus m WHERE ${where} ORDER BY ${col} ${dir}, m.id ${dir} LIMIT $6 OFFSET $7`, [...args, f.limit, f.offset]),
    q.query(`SELECT count(*)::int AS n FROM navigation_menus m WHERE ${where}`, args),
  ]);
  return { rows: rows.rows as Menu[], total: total.rows[0].n as number };
}

export async function updateMenu(
  q: Queryable, ctx: RequestContext, menuId: string, p: { name?: string; slug?: string; placement?: string },
): Promise<Menu> {
  const { rows } = await q.query(
    `UPDATE navigation_menus m SET name = COALESCE($4, name), slug = COALESCE($5, slug),
       placement = COALESCE($6, placement), version = version + 1, updated_by = $7, updated_at = now()
     WHERE m.id = $1 AND m.tenant_id = $2 AND m.organization_id = $3 AND m.deleted_at IS NULL
     RETURNING ${MENU}`,
    [menuId, ctx.tenantId, ctx.organizationId, p.name ?? null, p.slug ?? null, p.placement ?? null, ctx.userId],
  );
  return rows[0];
}

export async function bumpVersion(q: Queryable, ctx: RequestContext, menuId: string): Promise<number> {
  const { rows } = await q.query(
    'UPDATE navigation_menus SET version = version + 1, updated_by = $2, updated_at = now() WHERE id = $1 RETURNING version',
    [menuId, ctx.userId],
  );
  return rows[0].version;
}

export async function archiveMenu(q: Queryable, ctx: RequestContext, menuId: string): Promise<void> {
  await q.query(
    `UPDATE navigation_menus SET status = 'ARCHIVED', deleted_at = now(), version = version + 1, updated_by = $2, updated_at = now()
     WHERE id = $1`,
    [menuId, ctx.userId],
  );
}

// ---- items ----
async function attachTranslations(q: Queryable, items: Item[], menuId: string) {
  const { rows } = await q.query(
    `SELECT t.item_id::text AS "itemId", t.locale, t.label, t.accessibility_label AS "accessibilityLabel"
     FROM navigation_item_translations t JOIN navigation_items i ON i.id = t.item_id
     WHERE i.menu_id = $1 ORDER BY t.locale`,
    [menuId],
  );
  const byItem = new Map<string, Translation[]>();
  for (const r of rows) {
    const list = byItem.get(r.itemId) ?? [];
    list.push({ locale: r.locale, label: r.label, accessibilityLabel: r.accessibilityLabel });
    byItem.set(r.itemId, list);
  }
  for (const i of items) i.translations = byItem.get(i.id) ?? [];
  return items;
}

export async function listItems(q: Queryable, menuId: string): Promise<Item[]> {
  const { rows } = await q.query(`SELECT ${ITEM} FROM navigation_items i WHERE i.menu_id = $1 ORDER BY i.sort_order, i.id`, [menuId]);
  return attachTranslations(q, rows, menuId);
}

export async function getItem(q: Queryable, menuId: string, itemId: string): Promise<Item | undefined> {
  const { rows } = await q.query(`SELECT ${ITEM} FROM navigation_items i WHERE i.id = $1 AND i.menu_id = $2`, [itemId, menuId]);
  if (!rows[0]) return undefined;
  const { rows: tr } = await q.query(
    'SELECT locale, label, accessibility_label AS "accessibilityLabel" FROM navigation_item_translations WHERE item_id = $1 ORDER BY locale',
    [itemId],
  );
  rows[0].translations = tr;
  return rows[0];
}

export interface ItemValues {
  parentItemId: string | null; label: string; dest: Destination;
  sortOrder?: number; openInNewTab: boolean; accessibilityLabel: string | null;
}

export async function insertItem(q: Queryable, menuId: string, v: ItemValues): Promise<string> {
  const { rows } = await q.query(
    `INSERT INTO navigation_items
       (menu_id, parent_item_id, label, item_kind, link_type, target_page_id, external_url, anchor, system_route,
        sort_order, open_in_new_tab, accessibility_label)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
       COALESCE($10::int, (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM navigation_items
                           WHERE menu_id = $1 AND parent_item_id IS NOT DISTINCT FROM $2::bigint)),
       $11,$12)
     RETURNING id::text AS id`,
    [menuId, v.parentItemId, v.label, v.dest.itemKind, v.dest.linkType, v.dest.targetPageId, v.dest.externalUrl,
      v.dest.anchor, v.dest.systemRoute, v.sortOrder ?? null, v.openInNewTab, v.accessibilityLabel],
  );
  return rows[0].id;
}

export async function updateItemRow(q: Queryable, menuId: string, itemId: string, v: ItemValues & { sortOrder: number }) {
  await q.query(
    `UPDATE navigation_items SET parent_item_id = $3, label = $4, item_kind = $5, link_type = $6, target_page_id = $7,
       external_url = $8, anchor = $9, system_route = $10, sort_order = $11, open_in_new_tab = $12,
       accessibility_label = $13, updated_at = now()
     WHERE id = $1 AND menu_id = $2`,
    [itemId, menuId, v.parentItemId, v.label, v.dest.itemKind, v.dest.linkType, v.dest.targetPageId, v.dest.externalUrl,
      v.dest.anchor, v.dest.systemRoute, v.sortOrder, v.openInNewTab, v.accessibilityLabel],
  );
}

export async function replaceTranslations(q: Queryable, itemId: string, list: Translation[]) {
  await q.query('DELETE FROM navigation_item_translations WHERE item_id = $1', [itemId]);
  for (const t of list) {
    await q.query(
      'INSERT INTO navigation_item_translations (item_id, locale, label, accessibility_label) VALUES ($1,$2,$3,$4)',
      [itemId, t.locale, t.label, t.accessibilityLabel ?? null],
    );
  }
}

export async function deleteItem(q: Queryable, menuId: string, itemId: string): Promise<boolean> {
  const r = await q.query('DELETE FROM navigation_items WHERE id = $1 AND menu_id = $2', [itemId, menuId]); // children cascade
  return (r.rowCount ?? 0) > 0;
}

export async function deleteAllItems(q: Queryable, menuId: string) {
  await q.query('DELETE FROM navigation_items WHERE menu_id = $1', [menuId]);
}

export async function applyReorder(
  q: Queryable, menuId: string, moves: { itemId: string; parentItemId: string | null; sortOrder: number }[],
) {
  await q.query(
    `UPDATE navigation_items i SET parent_item_id = v.parent_id, sort_order = v.sort_order, updated_at = now()
     FROM unnest($2::bigint[], $3::bigint[], $4::int[]) AS v(id, parent_id, sort_order)
     WHERE i.id = v.id AND i.menu_id = $1`,
    [menuId, moves.map((m) => m.itemId), moves.map((m) => m.parentItemId), moves.map((m) => m.sortOrder)],
  );
}

// ---- revisions ----
export async function nextRevisionNumber(q: Queryable, menuId: string): Promise<number> {
  const { rows } = await q.query('SELECT COALESCE(MAX(revision_number), 0) + 1 AS n FROM navigation_revisions WHERE menu_id = $1', [menuId]);
  return rows[0].n;
}

export async function insertRevision(
  q: Queryable, ctx: RequestContext, menuId: string, n: number, doc: RevisionDocument, checksum: string,
): Promise<Revision> {
  const { rows } = await q.query(
    `INSERT INTO navigation_revisions AS r (menu_id, revision_number, document_json, checksum, status, created_by)
     VALUES ($1,$2,$3,$4,'DRAFT',$5) RETURNING ${REVISION}`,
    [menuId, n, JSON.stringify(doc), checksum, ctx.userId],
  );
  return rows[0];
}

export async function listRevisions(q: Queryable, menuId: string, limit: number, offset: number) {
  const [rows, total] = await Promise.all([
    q.query(`SELECT ${REVISION} FROM navigation_revisions r WHERE r.menu_id = $1 ORDER BY r.revision_number DESC LIMIT $2 OFFSET $3`, [menuId, limit, offset]),
    q.query('SELECT count(*)::int AS n FROM navigation_revisions WHERE menu_id = $1', [menuId]),
  ]);
  return { rows: rows.rows as Revision[], total: total.rows[0].n as number };
}

export async function getRevisionWithDoc(q: Queryable, menuId: string, revisionId: string) {
  const { rows } = await q.query(
    `SELECT ${REVISION}, r.document_json AS doc FROM navigation_revisions r WHERE r.id = $1 AND r.menu_id = $2`,
    [revisionId, menuId],
  );
  return rows[0] as (Revision & { doc: RevisionDocument }) | undefined;
}

export async function publishRevision(q: Queryable, menuId: string, revisionId: string): Promise<Revision> {
  await q.query(`UPDATE navigation_revisions SET status = 'ARCHIVED' WHERE menu_id = $1 AND status = 'PUBLISHED'`, [menuId]);
  const { rows } = await q.query(
    `UPDATE navigation_revisions r SET status = 'PUBLISHED', published_at = now() WHERE r.id = $1 AND r.menu_id = $2 RETURNING ${REVISION}`,
    [revisionId, menuId],
  );
  await q.query(`UPDATE navigation_menus SET status = 'PUBLISHED', current_published_revision_id = $2, updated_at = now() WHERE id = $1`, [menuId, revisionId]);
  return rows[0];
}

export async function publishedForPlacement(q: Queryable, websiteId: string, placement: string) {
  const { rows } = await q.query(
    `SELECT m.name, m.slug, r.revision_number AS "revisionNumber", r.published_at AS "publishedAt", r.document_json AS doc
     FROM navigation_menus m JOIN navigation_revisions r ON r.id = m.current_published_revision_id
     WHERE m.website_id = $1 AND m.placement = $2 AND m.deleted_at IS NULL AND m.status = 'PUBLISHED' AND r.status = 'PUBLISHED'
     ORDER BY m.id`,
    [websiteId, placement],
  );
  return rows as { name: string; slug: string; revisionNumber: number; publishedAt: string; doc: RevisionDocument }[];
}

import type { Queryable } from '../db/pool';
import type { RequestContext } from '../types';

export type NavigationEventType =
  | 'navigation.menu.created.v1'
  | 'navigation.draft.updated.v1'
  | 'navigation.revision.published.v1'
  | 'navigation.menu.archived.v1'
  | 'navigation.publish.failed.v1';

// Written in the same transaction as the change (transactional outbox). Never contains tokens/secrets.
export async function enqueueEvent(
  q: Queryable,
  ctx: RequestContext,
  eventType: NavigationEventType,
  p: { websiteId: string; menuId: string; revisionId?: string | null; reason?: string },
) {
  const payload = {
    eventType,
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    requestId: ctx.requestId,
    actorUserId: ctx.userId,
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    websiteId: p.websiteId,
    menuId: p.menuId,
    revisionId: p.revisionId ?? null,
    ...(p.reason ? { reason: p.reason } : {}),
  };
  await q.query('INSERT INTO outbox_events (event_type, payload) VALUES ($1, $2)', [eventType, JSON.stringify(payload)]);
}

export async function insertAudit(
  q: Queryable,
  ctx: RequestContext,
  a: { websiteId: string; action: string; resourceType: string; resourceId: string; metadata?: object },
) {
  await q.query(
    `INSERT INTO navigation_audit_logs
       (tenant_id, organization_id, website_id, actor_user_id, action, resource_type, resource_id, request_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [ctx.tenantId, ctx.organizationId, a.websiteId, ctx.userId, a.action, a.resourceType, a.resourceId, ctx.requestId,
      JSON.stringify(a.metadata ?? {})],
  );
}

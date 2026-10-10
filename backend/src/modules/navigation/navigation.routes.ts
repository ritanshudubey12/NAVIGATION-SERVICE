import { Router, type Request, type RequestHandler, type Response } from 'express';
import { ApiError } from '../../errors';
import { isValidId } from '../../ids';
import { requirePermission as perm } from '../../middleware/require-permission';
import { validateBody, validateQuery } from '../../middleware/validate';
import type { RequestContext } from '../../types';
import {
  createItemSchema, createMenuSchema, createRevisionSchema, listMenusQuery, pageQuery, patchItemSchema, patchMenuSchema,
  placementParam, reorderSchema, revisionActionSchema,
} from './navigation.schemas';
import { NavigationService } from './navigation.service';

type Handler = (req: Request, res: Response) => Promise<void>;
const h = (fn: Handler): RequestHandler => (req, res, next) => fn(req, res).catch(next);
const ctxOf = (req: Request): RequestContext => req.ctx!;
const ifMatch = (req: Request) => req.header('if-match');

function send(req: Request, res: Response, status: number, data: unknown, meta: object = {}) {
  res.status(status).json({ success: true, data, meta: { requestId: req.requestId, ...meta } });
}
const etag = (res: Response, version: number) => void res.setHeader('ETag', `W/"${version}"`);

// Authenticated routes. Mounted under /api/v1 after the authenticate middleware.
export function createNavigationRouter(svc: NavigationService, idem: RequestHandler): Router {
  const r = Router();

  for (const p of ['websiteId', 'menuId', 'itemId']) {
    r.param(p, (_req, _res, next, value) =>
      isValidId(value) ? next() : next(new ApiError(400, 'INVALID_ID', `${p} must be a positive BIGINT decimal string.`)));
  }
  r.use((req, res, next) => (req.method === 'POST' ? idem(req, res, next) : next()));

  // ---- menus ----
  r.get('/websites/:websiteId/navigation-menus', perm('navigation:read'), validateQuery(listMenusQuery), h(async (req, res) => {
    const out = await svc.listMenus(ctxOf(req), req.params.websiteId, res.locals.query);
    send(req, res, 200, out.rows, { pagination: { total: out.total, limit: out.limit, offset: out.offset } });
  }));

  r.post('/websites/:websiteId/navigation-menus', perm('navigation:create'), validateBody(createMenuSchema), h(async (req, res) => {
    const menu = await svc.createMenu(ctxOf(req), req.params.websiteId, req.body);
    res.setHeader('Location', `/api/v1/navigation-menus/${menu.id}`);
    etag(res, menu.version);
    send(req, res, 201, menu);
  }));

  r.get('/navigation-menus/:menuId', perm('navigation:read'), h(async (req, res) => {
    const menu = await svc.getMenu(ctxOf(req), req.params.menuId);
    etag(res, menu.version);
    send(req, res, 200, menu);
  }));

  r.patch('/navigation-menus/:menuId', perm('navigation:update'), validateBody(patchMenuSchema), h(async (req, res) => {
    const menu = await svc.updateMenu(ctxOf(req), req.params.menuId, req.body, ifMatch(req));
    etag(res, menu.version);
    send(req, res, 200, menu);
  }));

  r.delete('/navigation-menus/:menuId', perm('navigation:archive', 'navigation:delete'), h(async (req, res) => {
    send(req, res, 200, await svc.archiveMenu(ctxOf(req), req.params.menuId));
  }));

  // ---- items ----
  r.get('/navigation-menus/:menuId/items', perm('navigation:read'), h(async (req, res) => {
    const { menu, items } = await svc.getTree(ctxOf(req), req.params.menuId);
    etag(res, menu.version);
    send(req, res, 200, { menuId: menu.id, version: menu.version, items });
  }));

  r.post('/navigation-menus/:menuId/items', perm('navigation:update'), validateBody(createItemSchema), h(async (req, res) => {
    const { item, version } = await svc.createItem(ctxOf(req), req.params.menuId, req.body, ifMatch(req));
    res.setHeader('Location', `/api/v1/navigation-menus/${item.menuId}/items/${item.id}`);
    etag(res, version);
    send(req, res, 201, item, { menuVersion: version });
  }));

  r.patch('/navigation-menus/:menuId/items/:itemId', perm('navigation:update'), validateBody(patchItemSchema), h(async (req, res) => {
    const { item, version } = await svc.updateItem(ctxOf(req), req.params.menuId, req.params.itemId, req.body, ifMatch(req));
    etag(res, version);
    send(req, res, 200, item, { menuVersion: version });
  }));

  r.delete('/navigation-menus/:menuId/items/:itemId', perm('navigation:update'), h(async (req, res) => {
    const out = await svc.deleteItem(ctxOf(req), req.params.menuId, req.params.itemId, ifMatch(req));
    etag(res, out.version);
    send(req, res, 200, out);
  }));

  r.post('/navigation-menus/:menuId/reorder', perm('navigation:update'), validateBody(reorderSchema), h(async (req, res) => {
    const { menu, items } = await svc.reorder(ctxOf(req), req.params.menuId, req.body, ifMatch(req));
    etag(res, menu.version);
    send(req, res, 200, { menuId: menu.id, version: menu.version, items });
  }));

  // ---- revisions ----
  r.post('/navigation-menus/:menuId/revisions', perm('navigation:update'), validateBody(createRevisionSchema), h(async (req, res) => {
    send(req, res, 201, await svc.createRevision(ctxOf(req), req.params.menuId));
  }));

  r.get('/navigation-menus/:menuId/revisions', perm('navigation:read'), validateQuery(pageQuery), h(async (req, res) => {
    const out = await svc.listRevisions(ctxOf(req), req.params.menuId, res.locals.query);
    send(req, res, 200, out.rows, { pagination: { total: out.total, limit: out.limit, offset: out.offset } });
  }));

  r.post('/navigation-menus/:menuId/publish', perm('navigation:publish'), validateBody(revisionActionSchema), h(async (req, res) => {
    const out = await svc.publish(ctxOf(req), req.params.menuId, req.body.revisionId, ifMatch(req));
    send(req, res, 200, { menu: out.menu, revision: out.revision, alreadyPublished: out.alreadyPublished });
  }));

  r.post('/navigation-menus/:menuId/restore', perm('navigation:update'), validateBody(revisionActionSchema), h(async (req, res) => {
    const out = await svc.restore(ctxOf(req), req.params.menuId, req.body.revisionId, ifMatch(req));
    etag(res, out.menu.version);
    send(req, res, 201, { revision: out.revision, menuVersion: out.menu.version });
  }));

  return r;
}

// Public, unauthenticated, published-only reads (enabled by PUBLIC_NAVIGATION_ENABLED).
export function createPublicRouter(svc: NavigationService, enabled: boolean): Router {
  const r = Router();
  r.get('/websites/:websiteId/navigation/:placement', h(async (req, res) => {
    if (!enabled) throw new ApiError(404, 'NOT_FOUND', 'Route not found.');
    if (!isValidId(req.params.websiteId)) throw new ApiError(400, 'INVALID_ID', 'websiteId must be a positive BIGINT decimal string.');
    const placement = placementParam.safeParse(req.params.placement.toUpperCase());
    if (!placement.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Unknown placement.');
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    send(req, res, 200, await svc.getPublished(req.params.websiteId, placement.data));
  }));
  return r;
}

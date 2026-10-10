import type { Config } from '../config/env';
import { ApiError, badRequest } from '../errors';
import type { RequestContext } from '../types';
import { getStatus } from './http';

// Page API owns pages; internal links must resolve to a page of the authorized website.
export class PageClient {
  constructor(private readonly cfg: Config) {}

  async assertExists(ctx: RequestContext, websiteId: string, pageId: string): Promise<void> {
    const q = new URLSearchParams({ tenantId: ctx.tenantId, organizationId: ctx.organizationId });
    const status = await getStatus(
      `${this.cfg.PAGE_API_URL}/internal/websites/${websiteId}/pages/${pageId}?${q}`,
      ctx.requestId,
      this.cfg.INTEGRATION_TIMEOUT_MS,
    );
    if (status === 200) return;
    if (status === 403 || status === 404) {
      throw badRequest('targetPageId does not reference a page of this website.', { targetPageId: pageId });
    }
    throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Page service returned an unexpected response.');
  }
}

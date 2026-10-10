import type { Config } from '../config/env';
import { ApiError } from '../errors';
import type { RequestContext } from '../types';
import { getStatus } from './http';

// Website API owns website ownership/access; the URL websiteId alone never authorizes.
export class WebsiteClient {
  constructor(private readonly cfg: Config) {}

  async assertAccess(ctx: RequestContext, websiteId: string): Promise<void> {
    const q = new URLSearchParams({ tenantId: ctx.tenantId, organizationId: ctx.organizationId, userId: ctx.userId });
    const status = await getStatus(
      `${this.cfg.WEBSITE_API_URL}/internal/websites/${websiteId}/access?${q}`,
      ctx.requestId,
      this.cfg.INTEGRATION_TIMEOUT_MS,
    );
    if (status === 200) return;
    if (status === 403 || status === 404) throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this website.');
    throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Website service returned an unexpected response.');
  }
}

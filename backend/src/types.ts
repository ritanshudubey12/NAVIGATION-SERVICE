// IDs are decimal strings (see ids.ts); never converted to Number.
export interface RequestContext {
  userId: string;
  tenantId: string;
  organizationId: string;
  roles: string[];
  permissions: string[];
  requestId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      ctx?: RequestContext;
    }
  }
}

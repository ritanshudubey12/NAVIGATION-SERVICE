import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { NextFunction, Request, Response } from 'express';
import type { Config } from '../config/env';
import { ApiError } from '../errors';
import { isValidId } from '../ids';

const unauthenticated = (message: string) => new ApiError(401, 'UNAUTHENTICATED', message);
const stringArray = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null;

// Verifies the Bearer JWT (signature via trusted JWKS, iss, aud, exp/nbf, algorithm allowlist)
// and builds the trusted RequestContext. The token is read ONLY from the Authorization header.
//
// Membership: the identity provider's signed claims (tenant_id, organization_id, permissions)
// are used as the membership result. If the platform requires a live membership lookup,
// resolve it here before attaching the context.
export function createAuthenticator(cfg: Config) {
  const jwks = createRemoteJWKSet(new URL(cfg.JWT_JWKS_URL), { timeoutDuration: 3000 });

  return async function authenticate(req: Request, _res: Response, next: NextFunction) {
    const match = /^Bearer ([^\s]+)$/.exec(req.header('authorization') ?? '');
    if (!match) return next(unauthenticated('Bearer token required.'));
    try {
      const { payload } = await jwtVerify(match[1], jwks, {
        issuer: cfg.JWT_ISSUER,
        audience: cfg.JWT_AUDIENCE,
        algorithms: cfg.algorithms,
        clockTolerance: 5,
      });
      const tenantId = payload.tenant_id;
      const organizationId = payload.organization_id;
      const permissions = stringArray(payload.permissions);
      const roles = stringArray(payload.roles) ?? [];
      if (!isValidId(payload.sub) || !isValidId(tenantId) || !isValidId(organizationId) || !permissions) {
        return next(unauthenticated('Token is missing required identity claims.'));
      }
      req.ctx = {
        userId: payload.sub as string,
        tenantId: tenantId as string,
        organizationId: organizationId as string,
        roles,
        permissions,
        requestId: req.requestId,
      };
      return next();
    } catch {
      return next(unauthenticated('Invalid or expired token.'));
    }
  };
}

import { createHash } from 'crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Pool } from 'pg';
import { ApiError, badRequest } from '../errors';
import type { Logger } from '../observability/logger';

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

// Idempotency-Key for retryable POSTs. The key is claimed up-front (so concurrent duplicates
// are rejected), the 2xx response is stored, and the claim is released on any failure.
// Same key + same payload -> original response replayed; same key + different payload -> 409.
export function idempotency(pool: Pool, log: Logger): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = req.header('idempotency-key');
    if (!key) return next();
    try {
      if (!/^[\w.:-]{8,128}$/.test(key)) throw badRequest('Idempotency-Key must be 8-128 chars of [A-Za-z0-9_.:-].');
      const ctx = req.ctx!;
      const hash = createHash('sha256')
        .update(`${req.method} ${req.originalUrl.split('?')[0]} ${stableStringify(req.body)}`)
        .digest('hex');
      const scope = [ctx.tenantId, ctx.organizationId, ctx.userId, key];

      const claim = await pool.query(
        `INSERT INTO idempotency_keys (tenant_id, organization_id, user_id, idem_key, request_hash)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [...scope, hash],
      );
      if (!claim.rowCount) {
        const { rows } = await pool.query(
          `SELECT request_hash, response_status, response_body FROM idempotency_keys
           WHERE tenant_id=$1 AND organization_id=$2 AND user_id=$3 AND idem_key=$4`,
          scope,
        );
        const row = rows[0];
        if (!row) return next(new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Please retry the request.'));
        if (row.request_hash !== hash) {
          return next(new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key was used with a different request.'));
        }
        if (row.response_status === null) {
          return next(new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'A request with this key is still in progress.'));
        }
        res.setHeader('Idempotency-Replayed', 'true');
        return void res.status(row.response_status).json(row.response_body);
      }

      const original = res.json.bind(res);
      res.json = (body: unknown) => {
        const stmt =
          res.statusCode >= 200 && res.statusCode < 300
            ? pool.query(
                `UPDATE idempotency_keys SET response_status=$5, response_body=$6
                 WHERE tenant_id=$1 AND organization_id=$2 AND user_id=$3 AND idem_key=$4`,
                [...scope, res.statusCode, JSON.stringify(body)],
              )
            : pool.query(
                `DELETE FROM idempotency_keys
                 WHERE tenant_id=$1 AND organization_id=$2 AND user_id=$3 AND idem_key=$4`,
                scope,
              );
        stmt.catch((e) => log.error({ err: e.message }, 'idempotency bookkeeping failed'));
        return original(body);
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}

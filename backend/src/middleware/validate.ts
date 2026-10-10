import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { badRequest } from '../errors';

const issues = (e: { issues: { path: (string | number)[]; message: string }[] }) =>
  e.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));

export const validateBody = (schema: ZodTypeAny) => (req: Request, _res: Response, next: NextFunction) => {
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) return next(badRequest('Request body is invalid.', issues(parsed.error)));
  req.body = parsed.data;
  next();
};

// Validated query is placed on res.locals.query.
export const validateQuery = (schema: ZodTypeAny) => (req: Request, res: Response, next: NextFunction) => {
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return next(badRequest('Query parameters are invalid.', issues(parsed.error)));
  res.locals.query = parsed.data;
  next();
};

import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../errors';

// Passes when the caller holds navigation:admin or ANY of the listed permissions.
export const requirePermission =
  (...anyOf: string[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const have = req.ctx?.permissions ?? [];
    if (have.includes('navigation:admin') || anyOf.some((p) => have.includes(p))) return next();
    next(new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action.'));
  };

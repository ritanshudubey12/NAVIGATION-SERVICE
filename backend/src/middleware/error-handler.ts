import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ApiError } from '../errors';

export const notFoundHandler: RequestHandler = (req, _res, next) =>
  next(new ApiError(404, 'NOT_FOUND', 'Route not found.'));

// Never returns stack traces, SQL or internals.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Unexpected error.';
  let details: unknown;

  if (err instanceof ApiError) {
    ({ status, code, message, details } = err);
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Malformed JSON body.';
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body is too large.';
  } else {
    req.log?.error({ err: { message: err?.message, code: err?.code } }, 'unhandled error');
  }

  res.status(status).json({
    success: false,
    error: { code, message, ...(details !== undefined ? { details } : {}) },
    meta: { requestId: req.requestId },
  });
};

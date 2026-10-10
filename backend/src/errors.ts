export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown, code = 'VALIDATION_ERROR') =>
  new ApiError(400, code, message, details);
export const notFound = (what = 'Resource') => new ApiError(404, 'NOT_FOUND', `${what} not found.`);

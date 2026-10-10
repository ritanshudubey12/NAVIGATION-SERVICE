import { ApiError } from '../errors';

// Minimal timeout-guarded GET to another platform service; returns only the status code.
export async function getStatus(url: string, requestId: string, timeoutMs: number): Promise<number> {
  try {
    const res = await fetch(url, {
      headers: { 'x-request-id': requestId, accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.status;
  } catch {
    throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'A required upstream service is unavailable.');
  }
}

// PostgreSQL BIGINT ids travel as decimal strings everywhere (JSON, OpenAPI, claims).
const BIGINT_MAX = 9223372036854775807n;

export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= BIGINT_MAX;
}

export function compareIds(a: string, b: string): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4019),
  LOG_LEVEL: z.string().default('info'),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10000),
  DB_HOST: z.string().default('db'),
  DB_PORT: z.coerce.number().int().default(5432),
  DB_NAME: z.string().default('navigation'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  JWT_ISSUER: z.string().min(1),
  JWT_AUDIENCE: z.string().min(1),
  JWT_JWKS_URL: z.string().url(),
  JWT_ALGORITHMS: z.string().default('RS256'),
  WEBSITE_API_URL: z.string().url(),
  PAGE_API_URL: z.string().url(),
  PUBLISHING_EVENT_SINK_URL: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  INTEGRATION_TIMEOUT_MS: z.coerce.number().int().min(100).default(3000),
  MAX_TREE_DEPTH: z.coerce.number().int().min(1).max(10).default(5),
  MAX_ITEMS_PER_MENU: z.coerce.number().int().min(1).max(2000).default(200),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(1000),
  PUBLIC_NAVIGATION_ENABLED: z.enum(['true', 'false']).default('true'),
  APPROVED_SYSTEM_ROUTES: z.string().default('/login,/account,/cart,/search'),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      'Invalid configuration: ' + parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  const c = parsed.data;
  if (c.NODE_ENV === 'production' && !c.JWT_JWKS_URL.startsWith('https://')) {
    throw new Error('JWT_JWKS_URL must use https in production.');
  }
  return {
    ...c,
    algorithms: c.JWT_ALGORITHMS.split(',').map((s) => s.trim()).filter(Boolean),
    approvedSystemRoutes: c.APPROVED_SYSTEM_ROUTES.split(',').map((s) => s.trim()).filter(Boolean),
    publicNavigationEnabled: c.PUBLIC_NAVIGATION_ENABLED === 'true',
  };
}

export type Config = ReturnType<typeof loadConfig>;

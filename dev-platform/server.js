// LOCAL DEVELOPMENT / TEST STAND-IN for the platform services the Navigation API integrates with:
//   * Identity provider: JWKS + a token-minting endpoint (the Navigation API only VERIFIES tokens)
//   * Website API: GET /internal/websites/:id/access
//   * Page API:    GET /internal/websites/:id/pages/:pageId
//   * Event sink:  POST /internal/events (stands in for the Publishing API / cache invalidation)
// Not for production. Replace with the real services via the *_URL / JWT_* settings.
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { SignJWT, exportJWK, generateKeyPair } = require('jose');

const ISSUER = process.env.JWT_ISSUER || 'http://dev-platform:4010';
const AUDIENCE = process.env.JWT_AUDIENCE || 'navigation-api';
const secretFile = process.env.IDP_CLIENT_SECRET_FILE || '/run/secrets/idp_client_secret';
const CLIENT_SECRET = fs.readFileSync(secretFile, 'utf8').trim();

// tenant -> organization -> websites -> pages (seed data)
const WEBSITES = {
  67890: { tenant: '1001', org: '2001', pages: ['9007199254741001', '1001', '1002'] },
  67891: { tenant: '1001', org: '2001', pages: ['2001'] },
  70000: { tenant: '1002', org: '2002', pages: ['3001'] },
};
const events = [];
const ALL = ['navigation:read', 'navigation:create', 'navigation:update', 'navigation:publish', 'navigation:archive'];

const safeEqual = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};

(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: 'dev-key-1', alg: 'RS256', use: 'sig' };

  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/.well-known/jwks.json', (_req, res) => res.json({ keys: [jwk] }));

  app.post('/token', async (req, res) => {
    const b = req.body || {};
    if (!safeEqual(b.clientSecret ?? '', CLIENT_SECRET)) return res.status(401).json({ error: 'invalid_client' });
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      tenant_id: b.tenantId ?? '1001',
      organization_id: b.organizationId ?? '2001',
      permissions: b.permissions ?? ALL,
      roles: b.roles ?? ['editor'],
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'dev-key-1' })
      .setSubject(String(b.sub ?? '3001'))
      .setIssuer(b.issuer ?? ISSUER)
      .setAudience(b.audience ?? AUDIENCE)
      .setIssuedAt(now - 120)
      .setExpirationTime(now + (b.expiresIn ?? 3600))
      .sign(privateKey);
    res.json({ accessToken: token, tokenType: 'Bearer' });
  });

  app.get('/internal/websites/:id/access', (req, res) => {
    const w = WEBSITES[req.params.id];
    if (!w) return res.status(404).json({ error: 'not_found' });
    if (w.tenant !== req.query.tenantId || w.org !== req.query.organizationId) return res.status(403).json({ error: 'forbidden' });
    res.json({ ok: true });
  });

  app.get('/internal/websites/:id/pages/:pageId', (req, res) => {
    const w = WEBSITES[req.params.id];
    if (!w || w.tenant !== req.query.tenantId || w.org !== req.query.organizationId) return res.status(404).json({ error: 'not_found' });
    if (!w.pages.includes(req.params.pageId)) return res.status(404).json({ error: 'not_found' });
    res.json({ id: req.params.pageId });
  });

  app.post('/internal/events', (req, res) => {
    events.push(req.body);
    if (events.length > 500) events.shift();
    res.status(202).json({ accepted: true });
  });
  app.get('/internal/events', (_req, res) => res.json(events));

  app.listen(4010, () => console.log('dev-platform listening on :4010'));
})();

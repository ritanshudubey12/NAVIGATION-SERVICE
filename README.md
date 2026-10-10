# Navigation API microservice (website builder)

Node.js + TypeScript + Express, PostgreSQL via `pg` (parameterized SQL, SQL migrations, **no Prisma**), JWT Bearer auth
verified with `jose` against a JWKS, tenant/organization isolation, RBAC, BIGINT ids as strings, revisions + explicit
publish, idempotency, optimistic concurrency (ETag / If-Match), audit log and transactional outbox.
Design source: *Navigation API Microservice – Final Technical & Implementation Report*.

## Run

```bash
docker compose up -d --build        # db -> migrate (one-off job) -> dev-platform + navigation-api
curl localhost:4019/ready           # {"status":"ready"}
docker compose down -v              # stop and delete data
```

| Service | Port | Purpose |
|---|---|---|
| navigation-api | 4019 | the microservice (`/api/v1`) |
| dev-platform | 4010 | **local stand-in only**: JWKS + token minting, Website API, Page API, event sink |
| db | – | PostgreSQL 16 |

## Secrets (never in env vars, compose or git)

Docker secrets, mounted at `/run/secrets`, sourced from `secrets/*.txt` (git-ignored):
`db_user`, `db_password` (API + migrate + db), `idp_client_secret` (dev-platform only).
Regenerate: `printf '%s' "$(openssl rand -hex 16)" > secrets/db_password.txt` (then `docker compose down -v`).
In production use the platform secret manager and a real IdP; set `JWT_*`, `WEBSITE_API_URL`, `PAGE_API_URL`
(`NODE_ENV=production` requires an https JWKS URL). See `backend/.env.example`.

## Postman / Newman

Import `postman/navigation-api.postman_collection.json` and `postman/local.postman_environment.json`
(copy `postman/local.postman_environment.example.json` to `local.postman_environment.json` and paste in `secrets/idp_client_secret.txt`; the real file is git-ignored). Run top to bottom;
the first folder fetches tokens from the dev IdP. 79 requests / 195 assertions:

* 00–03, 05: every happy path asserts **200 OK** (GET/PATCH/DELETE/publish/reorder) or **201 Created** (POST create).
* 04: the security/validation contract (401/403/404/400/409), each asserting the documented error code.

```bash
docker run --rm -v "$PWD/postman:/etc/newman" postman/newman run navigation-api.postman_collection.json \
  -e local.postman_environment.json --env-var baseUrl=http://host.docker.internal:4019 --env-var idpUrl=http://host.docker.internal:4010
```

## Tests

```bash
docker build --target test ./backend    # typecheck + 23 unit tests (tree rules, URL/destination validation, BIGINT ids)
```

## API summary (`/api/v1`, Bearer required except `/public`)

| Method | Path | Permission | Success |
|---|---|---|---|
| GET/POST | `/websites/{websiteId}/navigation-menus` | read / create | 200 / 201 |
| GET/PATCH/DELETE | `/navigation-menus/{menuId}` | read / update / archive | 200 |
| GET/POST | `/navigation-menus/{menuId}/items` | read / update | 200 / 201 |
| PATCH/DELETE | `/navigation-menus/{menuId}/items/{itemId}` | update | 200 |
| POST | `/navigation-menus/{menuId}/reorder` | update | 200 |
| GET/POST | `/navigation-menus/{menuId}/revisions` | read / update | 200 / 201 |
| POST | `/navigation-menus/{menuId}/publish` · `/restore` | publish · update | 200 · 201 |
| GET | `/public/websites/{websiteId}/navigation/{placement}` | none (published only) | 200 |
| GET | `/health`, `/ready` | none | 200 |

Full contract: `backend/openapi/openapi.yaml`. Responses use `{ success, data, meta: { requestId } }`;
errors use `{ success:false, error:{ code, message, details? }, meta }`. DELETE of a menu **archives** it (200).

## Assumptions and not-yet-done (read before production)

* **Identity/membership:** tenant, organization and permissions come from the *signed* JWT claims (`tenant_id`,
  `organization_id`, `permissions`, `roles`, numeric `sub`). There is no live membership lookup; add one in
  `middleware/authenticate.ts` if the platform needs it. No `identity.client`/`localization.client` exist.
* **Website/Page/Event integrations** are HTTP calls to `WEBSITE_API_URL`/`PAGE_API_URL`/`PUBLISHING_EVENT_SINK_URL`
  using the contract implemented by `dev-platform` (`/internal/websites/:id/access`, `/internal/websites/:id/pages/:pageId`).
  These contracts and service-to-service auth must be aligned with the real services. Page references are checked at
  create/edit time and again at publish time.
* No Publishing-API orchestration beyond outbox events; no cache invalidation consumer.
* Not implemented: ESLint, load tests, DB-level integration/security test suites (API behaviour is covered by the
  Postman/Newman run), row-level security, rate limiting is per-process in memory.
* Tenancy for items/revisions is enforced through their menu (always loaded with tenant + organization scope first).
* `package-lock.json` is not committed; the Docker build runs `npm install`.

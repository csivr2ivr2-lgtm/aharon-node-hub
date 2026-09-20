# Aharon Search: backend-only integration

This Node Hub runs the **background API**, not the Aharon Search website. The website remains at https://search.aharon.cloud/ and the PHP CRM remains at https://crm.ivrphone.org/.

Do not point the search website's DNS to this Hub expecting its UI: this module registers **no /search/**, HTML, image upload or static files. Existing CRM routes, Google connectors, MCP and realtime endpoints remain on this same Node process.

## Hub environment

Keep existing Hub variables. Add `SEARCH_ENABLED=1` and a new independent `SEARCH_WORKER_TOKEN` with 32+ random characters. Do not put this token in the browser or share it with `AHARON_ADMIN_TOKEN`. Existing `SEARCH_SERPAPI_KEY`, `SEARCH_AI_REPORT_API_KEY`, `SEARCH_REGISTRY_DB_*`, `SEARCH_WHATSAPP_ENABLED` variables configure the worker-side services. `SEARCH_WORKER_MAX_JOBS` defaults to 12; `SEARCH_WORKER_RESULT_TTL_MS` defaults to 900000 (15 minutes). Queued requests and results are stored **in process memory only** and are lost after a restart.

Run the existing `app.cjs` entry file. The Hub's `WORKSPACE_BASE_URL=https://crm.ivrphone.org` and existing CRM bearer token are unchanged. No changes to CRM code are necessary for its existing Hub services.

## Private API contract

All endpoints require `Authorization: Bearer <SEARCH_WORKER_TOKEN>` on requests from the search site's own server (never client-side JS):

- `GET /v1/search-backend/status` — sanitized worker status.
- `POST /v1/search-backend/jobs` with JSON search fields accepted by Aharon Search — returns HTTP 202 and `id`.
- `GET /v1/search-backend/jobs/{id}` — `queued`, `running`, `complete` (includes `result` in the original `/api/search` response shape), or `error`.
- Optional providers: `POST /v1/search-backend/registry/search`, `GET /v1/search-backend/whatsapp/status`, `POST /v1/search-backend/whatsapp/connect/start`, `GET /v1/search-backend/whatsapp/connect/status`, `POST /v1/search-backend/whatsapp/logout`.

The original Aharon Search frontend calls its existing same-origin `/api/search` route. To actually offload those requests to this Hub, the site's own backend must proxy to this private API, or you must configure a compatible reverse proxy; **setting Hub environment variables alone cannot alter a separately deployed website**. Leave image uploads on the website and pass its public `image_url` to the job API. Never proxy the backend bearer token through a browser. An optional alternate server entry can be added to the search repository without overwriting its existing frontend/server source.

This worker uses the migrated Aharon Search engine/providers already in `apps/search/webapp/src`. It does not install new unofficial scrapers for unsupported services automatically.

# Aharon Search backend on the shared Node Hub

The Hub is **not** a second Aharon Search website. The live UI and same-origin website API remain at https://search.aharon.cloud/. The CRM remains at https://crm.ivrphone.org/; its existing integration with the Hub (`WORKSPACE_BASE_URL` and `WORKSPACE_SERVICE_TOKEN`) is unchanged.

The Hub's `app.cjs` loads `src/server-unified.js`, which registers only the authenticated, background-only API in `apps/search/backend/routes.js`. There are **no active `/search/` HTML, CSS, JavaScript or image-upload routes** on the Hub. Old copied UI files in `apps/search/webapp/public` are not served. The original `src/server.js` and all original CRM routes are unchanged.

See [BACKEND_ONLY.md](BACKEND_ONLY.md) for the complete API contract. Add `SEARCH_WORKER_TOKEN` (32+ random characters) to the Hub's Hostinger environment alongside the existing `SEARCH_ENABLED=1`. Existing `SEARCH_ADMIN_TOKEN` is not used by the new private backend and must not be reused as a cross-site server credential.

Aharon Search site's original code is preserved. To make its existing UI use the new backend, deploy the separate, optional `server-hub.cjs` entrypoint supplied in the `Aharon-Search` repository and set `SEARCH_HUB_URL=https://s.ivrphone.org` and `SEARCH_HUB_TOKEN` to the **same secret** as the Hub's `SEARCH_WORKER_TOKEN` on the WEBSITE server only. See the site's `docs/SHARED_NODE_HUB.md`.

The Hub provides a bounded in-memory work queue. A job can be lost across restarts; completed results are automatically expired after 15 minutes by default. No new Python/Go scraping workers are automatically installed. Optional providers require their own credentials and configuration.

# Hostinger / LiteSpeed: unified Hub + Search startup

Hostinger's `lsnode.js` uses CommonJS `require()` to load the configured startup file. It cannot synchronously require `src/server-unified.js` because that ESM module has top-level `await`.

**Startup file in Hostinger: `app.cjs`** (at the repository root).

The new `app.cjs` is a CommonJS bootstrap that invokes `import('./src/server-unified.js')` dynamically. The original Hub files `src/server.js` and `src/server-unified.js` are unchanged. Do not use either of those as the **startup file** under LiteSpeed.

Keep the existing environment variables for the Hub/CRM integration. To activate the search routes in the unified server, set:

```env
SEARCH_ENABLED=1
SEARCH_ADMIN_TOKEN=<random string of at least 32 characters>
```

All other search credentials and database settings are configured separately. Open `/health` for the original Hub and `/search/` for Search after deployment. The original `npm start` script remains unchanged; when running from an ordinary shell, `npm run start:unified` is also supported.

**Important:** A CommonJS bootstrap fixes `ERR_REQUIRE_ASYNC_MODULE` only; if startup subsequently fails because of missing environment variables or dependencies, fix the new error shown in the logs rather than switching back to an ESM startup file.

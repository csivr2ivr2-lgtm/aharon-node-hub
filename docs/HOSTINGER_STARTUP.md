# Hostinger / LiteSpeed startup: unified Hub + Search

`lsnode.js` loads the configured application startup file using `require()`. It cannot synchronously load `src/server.js` or `src/server-unified.js` because the ESM graph includes top-level await.

**Hostinger startup file: `app.cjs`** (repository root alongside `package.json`).

The root `app.cjs` is a CommonJS bootstrap that uses `import()` to start `src/server-unified.js`. It logs `HOSTINGER_CJS_BOOTSTRAP_LOADED` when actually loaded. No changes are made to the original Hub or CRM route code. `package.json` now has `main: app.cjs` and both `npm start` / `npm run start:unified` run `node app.cjs`; the original unmodified Hub can still be started intentionally with `npm run start:legacy`.

## Recovery from repeated ERR_REQUIRE_ASYNC_MODULE

1. In Hostinger, ensure the GitHub deployment uses the current `main` commit and that the latest deployment completed successfully. Re-deploy after changing the startup configuration; restart alone does not fetch an updated build.
2. In hPanel's Node.js application settings, if there is a **startup file** field, it must be exactly `app.cjs`. Do not enter `src/server.js`, `src/server-unified.js` or an npm command in that field.
3. If Hostinger exposes a **start command** instead, set it to `npm start` (which now runs `node app.cjs`). For direct CLI hosting, `node app.cjs` also works.
4. In the live deployed directory, check `hbuilds/current/nodejs/app.cjs` and `hbuilds/current/nodejs/package.json`. In legacy installations, the corresponding directory may be `nodejs/`. Ensure the startup path belongs to the same application root as these files. Hostinger may continue to serve an older successful build after a failed deployment.
5. Restart. Verify that the fresh **runtime log** contains `HOSTINGER_CJS_BOOTSTRAP_LOADED`. If it does not, LiteSpeed is still loading a different startup file or an older build. If it does, investigate the next, different error message rather than this startup-file error.

Preserve the existing CRM/Hub environment settings. Set `SEARCH_ENABLED=1` and an independently generated `SEARCH_ADMIN_TOKEN` of at least 32 characters to enable `/search/`. This startup change alone does not require new API keys.

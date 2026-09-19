# Aharon Node Hub

**One GitHub repository, one Hostinger Node.js application, one Node process** for Aharon Workspace and independent projects.

## What is included

- Workspace service proxy, search, real-time WebSocket and remote MCP for Aharon AI.
- **Built-in** Google multi-account OAuth connector: Gmail (read/send), Calendar (read) and Drive (metadata search).
- Encrypted connector token storage outside the web root.
- Idempotent message ingestion by forwarding normalized message IDs to the PHP CRM.
- Telegram/WhatsApp/Messenger reserved as optional modules. WhatsApp personal sessions are **not implemented or connected**.

## How to run

Node.js 20+; deploy this repository as **one** Node app. Entry point: `src/server.js` via `npm start`.

```bash
npm install --omit=dev
cp .env.example .env
npm start
```

Put real secrets in Hostinger environment settings or the untracked `.env`. Generate separate 32-byte random values for `CORE_API_TOKEN`, `MCP_API_TOKEN`, `WORKSPACE_SERVICE_TOKEN`, `CONNECTOR_VAULT_KEY`, and `OAUTH_STATE_SECRET`. The CRM `node_service_token` must match `WORKSPACE_SERVICE_TOKEN`; Aharon AI `WORKSPACE_MCP_TOKEN` must match `MCP_API_TOKEN`.

`GOOGLE_REDIRECT_URI` must be the public URL of **this same Node app** plus `/oauth/google/callback`. There is **no** second connector service and **no** `CONNECTORS_BASE_URL`.

The CRM and AI server continue to run in PHP and do not occupy Node.js app slots.

## Security

Source code is public. Runtime credentials, OAuth tokens and imported content are private; never commit `.env`, `runtime/`, sessions, DB dumps, Google credentials or user data. The WebSocket uses a one-time ticket obtained via the authenticated `POST /v1/ws-ticket`, not a long-lived API key in the URL. MCP remote endpoint is `/mcp` with a distinct bearer token. AI writes are disabled by default.

## Independent project modules

Add a new module under `src/apps/<project>/` and register its routes in the **same** Fastify server. Keep separate API keys, route prefixes and per-project storage. Do not start a second listener or a second `npm start`.

The legacy private `aharon-workspace-node` and `aharon-connectors` repositories are source backups, **not** deployment targets.

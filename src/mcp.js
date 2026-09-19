import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { config } from "./config.js";
import { WorkspaceClient } from "./clients/workspace.js";
import { ConnectorsClient } from "./clients/connectors.js";
import { bearerToken, constantTimeTokenEqual } from "./http.js";

const textResult = value => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }]
});

function createServer() {
  const workspace = new WorkspaceClient();
  const connectors = new ConnectorsClient();
  const server = new McpServer({ name: "aharon-workspace", version: "1.0.0" });

  server.tool("workspace_status", "Get Aharon Workspace service status and entity counts.", {}, async () =>
    textResult(await workspace.call("status"))
  );
  server.tool("search_workspace", "Search projects, clients, systems, tasks, conversations and accounts.", {
    q: z.string().min(1),
    limit: z.number().int().min(1).max(50).optional()
  }, async ({ q, limit }) => textResult(await workspace.call("search", { q, limit: limit ?? 25 })));

  server.tool("list_projects", "List Aharon Workspace projects.", {
    status: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional()
  }, async args => textResult(await workspace.call("project.list", args)));

  server.tool("get_project", "Get one project by Workspace project id.", {
    id: z.string().min(1)
  }, async ({ id }) => textResult(await workspace.call("project.get", { id })));

  server.tool("list_clients", "List CRM clients.", {
    q: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional()
  }, async args => textResult(await workspace.call("client.list", args)));

  server.tool("get_client", "Get one CRM client.", {
    id: z.string().min(1)
  }, async ({ id }) => textResult(await workspace.call("client.get", { id })));

  server.tool("list_systems", "List IVR/telephony systems, optionally by project/client/status.", {
    project_id: z.string().optional(),
    client_id: z.string().optional(),
    status: z.string().optional(),
    q: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional()
  }, async args => textResult(await workspace.call("system.list", args)));

  server.tool("get_system", "Get an IVR system by DID/number.", {
    did: z.string().min(1)
  }, async ({ did }) => textResult(await workspace.call("system.get", { did })));

  server.tool("list_tasks", "List Workspace tasks.", {
    status: z.string().optional(),
    project_id: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional()
  }, async args => textResult(await workspace.call("task.list", args)));

  server.tool("recent_activity", "Get recent Workspace activity timeline.", {
    limit: z.number().int().min(1).max(100).optional()
  }, async args => textResult(await workspace.call("activity.list", args)));

  server.tool("list_conversations", "List unified inbox conversations.", {
    channel: z.string().optional(),
    unread_only: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).optional()
  }, async args => textResult(await workspace.call("conversation.list", args)));

  server.tool("list_integrations", "Get external connector status.", {}, async () =>
    textResult(await connectors.status())
  );

  server.tool("google_gmail_recent", "Read recent Gmail messages from a connected Google account.", {
    account_id: z.string().optional(),
    max_results: z.number().int().min(1).max(50).optional(),
    q: z.string().optional()
  }, async args => textResult(await connectors.post("/v1/google/gmail/recent", args)));

  server.tool("google_calendar_upcoming", "Read upcoming Google Calendar events.", {
    account_id: z.string().optional(),
    max_results: z.number().int().min(1).max(50).optional()
  }, async args => textResult(await connectors.post("/v1/google/calendar/upcoming", args)));

  server.tool("google_drive_search", "Search Google Drive.", {
    account_id: z.string().optional(),
    q: z.string().min(1),
    max_results: z.number().int().min(1).max(50).optional()
  }, async args => textResult(await connectors.post("/v1/google/drive/search", args)));

  server.tool("create_task", "Create a Workspace task. Write access must be enabled on the Node core.", {
    title: z.string().min(1),
    priority: z.string().optional(),
    due_date: z.string().optional(),
    notes: z.string().optional(),
    project_ids: z.array(z.string()).optional()
  }, async args => {
    if (!config.mcpAllowWrites) return textResult({ ok: false, error: "writes_disabled" });
    return textResult(await workspace.call("task.create", args, { write: true }));
  });

  server.tool("update_task", "Update a Workspace task. Write access must be enabled.", {
    id: z.string().min(1),
    title: z.string().optional(),
    status: z.string().optional(),
    priority: z.string().optional(),
    due_date: z.string().optional(),
    notes: z.string().optional(),
    project_ids: z.array(z.string()).optional()
  }, async args => {
    if (!config.mcpAllowWrites) return textResult({ ok: false, error: "writes_disabled" });
    return textResult(await workspace.call("task.update", args, { write: true }));
  });

  server.tool("send_email", "Send email through a connected Google account. Sensitive writes must be enabled.", {
    account_id: z.string().optional(),
    to: z.string().min(3),
    subject: z.string().min(1),
    body: z.string()
  }, async args => {
    if (!config.mcpAllowSensitiveWrites) return textResult({ ok: false, error: "sensitive_writes_disabled" });
    return textResult(await connectors.post("/v1/google/gmail/send", args));
  });

  return server;
}

export async function handleMcp(request, reply) {
  const token = bearerToken(request);
  if (!constantTimeTokenEqual(token, config.mcpApiToken)) {
    reply.code(401).send({ error: "unauthorized" });
    return;
  }
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  reply.hijack();
  try {
    await transport.handleRequest(request.raw, reply.raw, request.body);
  } finally {
    await server.close().catch(() => {});
  }
}
import { google } from "googleapis";
import { config } from "../config.js";
import { createOauthState, verifyOauthState } from "./security.js";
import { emitCoreEvent } from "./http.js";

function header(headers, name) {
  const item = (headers || []).find(h => String(h.name || "").toLowerCase() === name.toLowerCase());
  return String(item?.value || "");
}
function messageTime(message) {
  const dateHeader = header(message.payload?.headers, "Date");
  const date = dateHeader ? new Date(dateHeader) : new Date(Number(message.internalDate || Date.now()));
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
function encodeHeader(value) {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return "=?UTF-8?B?" + Buffer.from(value, "utf8").toString("base64") + "?=";
}
function mimeMessage({ to, subject, body, from }) {
  const lines = [
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "To: " + to,
    ...(from ? ["From: " + from] : []),
    "Subject: " + encodeHeader(subject),
    "",
    body
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

export class GoogleConnector {
  constructor(vault) { this.vault = vault; }

  configured() {
    return Boolean(config.googleClientId && config.googleClientSecret && config.googleRedirectUri);
  }

  oauthClient(tokens = null, onTokens = null) {
    if (!this.configured()) throw new Error("Google OAuth is not configured");
    const client = new google.auth.OAuth2(config.googleClientId, config.googleClientSecret, config.googleRedirectUri);
    if (tokens) client.setCredentials(tokens);
    if (onTokens) client.on("tokens", onTokens);
    return client;
  }

  authUrl(accountHint = "") {
    const client = this.oauthClient();
    const state = createOauthState({ provider: "google", account_hint: accountHint });
    return client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: true,
      scope: config.googleScopes,
      state,
      login_hint: accountHint || undefined
    });
  }

  async callback(code, state) {
    const stateData = verifyOauthState(state);
    if (stateData.provider !== "google") throw new Error("Unexpected OAuth provider");
    const client = this.oauthClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const profile = (await oauth2.userinfo.get()).data;
    const accountId = String(profile.id || profile.email || "").trim();
    if (!accountId) throw new Error("Google profile did not contain an account id");
    const record = {
      provider: "google",
      id: accountId,
      email: String(profile.email || ""),
      name: String(profile.name || profile.email || accountId),
      picture: String(profile.picture || ""),
      tokens,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    await this.vault.set("google:" + accountId, record);
    await emitCoreEvent({ type: "connector.connected", source: "google", account_id: accountId, email: record.email });
    return this.publicAccount(record);
  }

  publicAccount(record) {
    return {
      provider: "google",
      id: record.id,
      email: record.email,
      name: record.name,
      picture: record.picture,
      connected_at: record.connected_at,
      updated_at: record.updated_at
    };
  }

  async accounts() {
    return (await this.vault.entries("google:")).map(({ value }) => this.publicAccount(value));
  }

  async accountRecord(requestedId = "") {
    if (requestedId) {
      const direct = await this.vault.get("google:" + requestedId);
      if (direct) return direct;
      const all = await this.vault.entries("google:");
      const byEmail = all.find(({ value }) => String(value.email).toLowerCase() === requestedId.toLowerCase());
      if (byEmail) return byEmail.value;
      throw new Error("Google account not found");
    }
    const all = await this.vault.entries("google:");
    if (all.length === 0) throw new Error("No Google account is connected");
    if (all.length > 1) throw new Error("account_id is required because multiple Google accounts are connected");
    return all[0].value;
  }

  async clientFor(record) {
    let current = record;
    const client = this.oauthClient(record.tokens, async fresh => {
      if (!fresh || Object.keys(fresh).length === 0) return;
      current = { ...current, tokens: { ...current.tokens, ...fresh }, updated_at: new Date().toISOString() };
      await this.vault.set("google:" + current.id, current);
    });
    return client;
  }

  async gmailRecent({ account_id = "", max_results = 20, q = "" } = {}) {
    const account = await this.accountRecord(account_id);
    const auth = await this.clientFor(account);
    const gmail = google.gmail({ version: "v1", auth });
    const list = await gmail.users.messages.list({
      userId: "me",
      maxResults: Math.min(50, Math.max(1, Number(max_results || 20))),
      q: q || undefined
    });
    const ids = (list.data.messages || []).map(m => m.id).filter(Boolean);
    const messages = [];
    for (const id of ids) {
      const item = (await gmail.users.messages.get({
        userId: "me",
        id,
        format: "metadata",
        metadataHeaders: ["From","To","Cc","Subject","Date","Message-ID"]
      })).data;
      messages.push({
        id: item.id,
        thread_id: item.threadId,
        from: header(item.payload?.headers, "From"),
        to: header(item.payload?.headers, "To"),
        cc: header(item.payload?.headers, "Cc"),
        subject: header(item.payload?.headers, "Subject"),
        message_id: header(item.payload?.headers, "Message-ID"),
        snippet: String(item.snippet || ""),
        unread: (item.labelIds || []).includes("UNREAD"),
        sent_at: messageTime(item)
      });
    }
    return { ok: true, account: this.publicAccount(account), messages };
  }

  async calendarUpcoming({ account_id = "", max_results = 20 } = {}) {
    const account = await this.accountRecord(account_id);
    const auth = await this.clientFor(account);
    const calendar = google.calendar({ version: "v3", auth });
    const response = await calendar.events.list({
      calendarId: "primary",
      timeMin: new Date().toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: Math.min(50, Math.max(1, Number(max_results || 20)))
    });
    return {
      ok: true,
      account: this.publicAccount(account),
      events: (response.data.items || []).map(event => ({
        id: event.id,
        summary: event.summary || "",
        description: event.description || "",
        start: event.start?.dateTime || event.start?.date || "",
        end: event.end?.dateTime || event.end?.date || "",
        location: event.location || "",
        html_link: event.htmlLink || ""
      }))
    };
  }

  async driveSearch({ account_id = "", q = "", max_results = 20 } = {}) {
    const account = await this.accountRecord(account_id);
    const auth = await this.clientFor(account);
    const drive = google.drive({ version: "v3", auth });
    const safe = String(q || "").replace(/'/g, "\\'");
    const response = await drive.files.list({
      q: "trashed=false and name contains '" + safe + "'",
      pageSize: Math.min(50, Math.max(1, Number(max_results || 20))),
      fields: "files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName,emailAddress))",
      orderBy: "modifiedTime desc"
    });
    return { ok: true, account: this.publicAccount(account), files: response.data.files || [] };
  }

  async sendEmail({ account_id = "", to, subject, body }) {
    const account = await this.accountRecord(account_id);
    const auth = await this.clientFor(account);
    const gmail = google.gmail({ version: "v1", auth });
    const response = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: mimeMessage({ to, subject, body, from: account.email }) }
    });
    return { ok: true, account: this.publicAccount(account), message_id: response.data.id, thread_id: response.data.threadId };
  }

  async sync() {
    const events = [];
    for (const account of await this.accounts()) {
      try {
        const recent = await this.gmailRecent({
          account_id: account.id,
          max_results: config.googleSyncMaxResults,
          q: config.googleSyncQuery
        });
        for (const m of recent.messages) {
          const fromSelf = String(m.from).toLowerCase().includes(String(account.email).toLowerCase());
          events.push({
            id: "gmail:" + account.id + ":" + m.id,
            type: "message",
            source: "google.gmail",
            channel: "email",
            account_id: account.id,
            account: { provider: "google", type: "email", identifier: account.email, label: account.name || account.email },
            conversation_external_id: "gmail:" + account.id + ":" + (m.thread_id || m.id),
            external_id: m.id,
            thread_id: m.thread_id,
            direction: fromSelf ? "out" : "in",
            sender: m.from,
            recipient: m.to,
            subject: m.subject,
            body: m.snippet,
            is_read: !m.unread,
            sent_at: m.sent_at
          });
        }
      } catch (error) {
        events.push({
          id: "google-sync-error:" + account.id + ":" + Date.now(),
          type: "sync.error",
          source: "google.gmail",
          account_id: account.id,
          title: "Google sync failed",
          error: error.message
        });
      }
    }
    return events;
  }
}
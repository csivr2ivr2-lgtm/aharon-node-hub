import { mkdir, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pino from 'pino';
import { normalizeUsername, phoneInfo } from './normalize.js';

async function loadBaileys() {
  const mod = await import('@whiskeysockets/baileys');
  return { makeWASocket: mod.default || mod.makeWASocket, useMultiFileAuthState: mod.useMultiFileAuthState };
}

function closeSocket(sock) {
  try { sock?.ws?.close?.(); } catch (_) {}
  try { sock?.end?.(undefined); } catch (_) {}
}

function cleanConnectionError(error) {
  const raw = String(error?.message || error || 'unknown error');
  const lower = raw.toLowerCase();
  if (lower.includes('timeout') || lower.includes('etimedout')) return { code: 'WHATSAPP_NETWORK_TIMEOUT', reason: 'חיבור WhatsApp הסתיים ב־timeout. בדוק רשת/סינון/Proxy.' };
  if (lower.includes('enotfound') || lower.includes('dns')) return { code: 'WHATSAPP_DNS_FAILED', reason: 'DNS לא פתר את שרתי WhatsApp. בדוק DNS/סינון.' };
  if (lower.includes('blocked') || lower.includes('forbidden') || lower.includes('econnrefused')) return { code: 'WHATSAPP_NETWORK_BLOCKED', reason: 'החיבור ל־WhatsApp נחסם או נדחה.' };
  return { code: 'WHATSAPP_SOCKET_ERROR', reason: raw.slice(-700) };
}

function msisdn(raw) {
  const info = phoneInfo(raw);
  if (info.status === 'ok' && info.whatsapp_msisdn) return info.whatsapp_msisdn;
  const digits = String(raw || '').replace(/\D+/g, '');
  if (digits.startsWith('0') && digits.length >= 9) return `972${digits.slice(1)}`;
  return digits;
}

function formatPairingCode(value) {
  const raw = String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!raw) return '';
  const groups = raw.match(/.{1,4}/g) || [raw];
  return groups.join('-');
}

function sessionCredsReady(sessionDir) {
  try {
    const raw = readFileSync(join(sessionDir, 'creds.json'), 'utf8');
    const creds = JSON.parse(raw);
    return Boolean(creds?.registered || creds?.me?.id || creds?.account?.details);
  } catch (_) {
    return false;
  }
}

export class WhatsAppLinkedDeviceProvider {
  constructor({ enabled = true, sessionDir, timeoutMs = 180000 } = {}) {
    this.enabled = Boolean(enabled);
    this.sessionDir = sessionDir || join(process.cwd(), 'webapp', 'data', 'whatsapp-auth');
    this.timeoutMs = Math.max(60000, Math.min(300000, Number(timeoutMs || 180000)));
    this.lastQr = '';
    this.lastPairingCode = '';
    this.pairingPhone = '';
    this.connecting = false;
    this.connected = false;
    this.socketOpen = false;
    this.connectionState = sessionCredsReady(this.sessionDir) ? 'session_ready' : 'setup_required';
    this.lastError = '';
  }

  _sessionReady() {
    return sessionCredsReady(this.sessionDir);
  }

  status() {
    const sessionReady = this._sessionReady();
    this.connected = Boolean(this.socketOpen);
    this.connectionState = this.socketOpen ? 'connected' : (sessionReady ? 'session_ready' : (this.connecting ? 'connecting' : 'setup_required'));
    return {
      enabled: this.enabled,
      provider: 'baileys',
      transport: 'websocket',
      browser_required: false,
      connected: this.connected,
      socket_open: Boolean(this.socketOpen),
      session_ready: Boolean(sessionReady),
      ready_for_lookup: Boolean(this.enabled && sessionReady),
      connecting: this.connecting,
      has_qr: Boolean(this.lastQr),
      has_pairing_code: Boolean(this.lastPairingCode),
      pairing_phone: this.pairingPhone,
      setup_required: Boolean(this.enabled && !sessionReady),
      connection_state: this.connectionState,
      last_error: this.lastError,
    };
  }

  connectStatus() {
    const status = this.status();
    return { ok: true, ...status, qr: status.session_ready ? '' : this.lastQr, pairing_code: status.session_ready ? '' : this.lastPairingCode };
  }

  async logout() {
    await rm(this.sessionDir, { recursive: true, force: true });
    this.connected = false;
    this.socketOpen = false;
    this.connectionState = 'setup_required';
    this.lastQr = '';
    this.lastPairingCode = '';
    this.pairingPhone = '';
    return { ok: true, status: this.status() };
  }

  async startConnect({ mode = 'qr', phone = '' } = {}) {
    if (!this.enabled) return { ok: false, status: 'disabled' };
    if (this._sessionReady()) return { ok: true, status: 'session_ready', session_ready: true };
    if (this.connecting) return { ok: true, status: 'connecting', qr: this.lastQr, pairing_code: this.lastPairingCode };

    const cleanMode = String(mode || 'qr').toLowerCase() === 'code' ? 'code' : 'qr';
    const pairingPhone = cleanMode === 'code' ? msisdn(phone) : '';
    if (cleanMode === 'code' && !/^\d{9,15}$/.test(pairingPhone)) {
      return { ok: false, status: 'invalid_phone', reason: 'מספר WhatsApp לא תקין לקבלת קוד חיבור.' };
    }

    this.connecting = true;
    this.lastQr = '';
    this.lastPairingCode = '';
    this.pairingPhone = pairingPhone;
    this.lastError = '';
    this._connectOnce({ mode: cleanMode, pairingPhone })
      .catch((error) => { this.lastError = String(error?.message || error); })
      .finally(() => { this.connecting = false; });
    return { ok: true, status: 'started', mode: cleanMode, pairing_phone: pairingPhone };
  }

  async _connectOnce({ mode = 'qr', pairingPhone = '' } = {}) {
    await this._withSocket(async () => ({ status: 'ok', connected: true }), { keepUntilOpen: true, mode, pairingPhone });
  }

  async lookup({ phone = '', username = '' } = {}) {
    if (!this.enabled) return { status: 'disabled' };
    const cleanUsername = normalizeUsername(username);
    if (!phone && !cleanUsername) return { status: 'skipped', reason: 'no phone or username supplied' };
    if (!this._sessionReady()) return { status: 'not_connected', provider: 'baileys', reason: 'יש לחבר WhatsApp לפני בדיקת מספרים.' };
    if (phone && cleanUsername) {
      const phoneLookup = await this.lookup({ phone });
      const usernameLookup = await this.lookup({ username: cleanUsername });
      const found = String(phoneLookup.username || '').replace(/^@/, '');
      let cross = { status: 'not_exposed', confidence: 40, reason: 'הספרייה לא חשפה username מתוך הפרופיל לפי מספר.' };
      if (found && found.toLowerCase() === cleanUsername.toLowerCase()) cross = { status: 'match', confidence: 96, supplied_username: cleanUsername, username_from_phone: found };
      else if (found) cross = { status: 'mismatch', confidence: 80, supplied_username: cleanUsername, username_from_phone: found };
      return { ...phoneLookup, supplied_username: cleanUsername, phone_lookup: phoneLookup, username_lookup: usernameLookup, cross_check: cross };
    }
    if (cleanUsername && !phone) {
      return { status: 'unsupported', provider: 'baileys', username: cleanUsername, public_link: `https://wa.me/${cleanUsername}`, reason: 'Baileys לא מספק כרגע resolver מתועד של username מדויק לחשבון.' };
    }

    const digits = msisdn(phone);
    if (!/^\d{7,15}$/.test(digits)) return { status: 'invalid', provider: 'baileys', reason: 'invalid phone number' };
    return this._withSocket(async (sock) => {
      const rows = await sock.onWhatsApp(digits);
      const row = Array.isArray(rows) ? rows.find((item) => item?.exists) : null;
      if (!row) return { status: 'ok', provider: 'baileys', registered: false, phone: digits };
      const jid = row.jid || `${digits}@s.whatsapp.net`;
      let profile_picture_url = '', about = '';
      try { profile_picture_url = await sock.profilePictureUrl(jid, 'image'); } catch (_) { try { profile_picture_url = await sock.profilePictureUrl(jid, 'preview'); } catch (_) {} }
      try {
        const status = await sock.fetchStatus(jid);
        about = typeof status === 'string' ? status : String(status?.status || status?.about || '');
      } catch (_) {}
      return {
        status: 'ok', provider: 'baileys', registered: true, phone: digits, jid,
        pushname: row.notify || row.name || '', verified_name: row.verifiedName || '', about,
        profile_picture_url, username: row.username || '',
        username_candidates: row.username ? [{ username: row.username, field: 'onWhatsApp.username' }] : [],
        visibility_note: 'Only fields visible to the linked WhatsApp account are returned.',
      };
    });
  }

  async _withSocket(action, { keepUntilOpen = false, mode = 'qr', pairingPhone = '' } = {}) {
    await mkdir(this.sessionDir, { recursive: true });
    const { makeWASocket, useMultiFileAuthState } = await loadBaileys();
    const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);
    const sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: ['Aharon Search', 'Chrome', '5.1.1'],
      markOnlineOnConnect: false,
      syncFullHistory: false,
      connectTimeoutMs: this.timeoutMs,
      defaultQueryTimeoutMs: this.timeoutMs,
      keepAliveIntervalMs: 30000,
      getMessage: async () => undefined,
      shouldSyncHistoryMessage: () => false,
    });

    return new Promise((resolve) => {
      let done = false;
      let pairingRequested = false;
      const finish = (payload) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const sessionReady = this._sessionReady() || Boolean(payload?.connected);
        this.connected = false;
        this.socketOpen = false;
        this.connectionState = sessionReady ? 'session_ready' : 'setup_required';
        if (sessionReady) {
          this.lastQr = '';
          this.lastPairingCode = '';
        }
        closeSocket(sock);
        resolve(payload);
      };
      const requestPairingCode = async () => {
        if (done || pairingRequested || mode !== 'code' || !pairingPhone || state.creds?.registered) return;
        pairingRequested = true;
        try {
          const code = await sock.requestPairingCode(pairingPhone);
          this.lastPairingCode = formatPairingCode(code);
        } catch (error) {
          this.lastError = cleanConnectionError(error).reason;
        }
      };
      const timer = setTimeout(() => finish({ status: 'error', provider: 'baileys', code: 'WHATSAPP_CONNECT_TIMEOUT', reason: 'לא התקבל חיבור מ־WhatsApp בזמן שהוגדר.' }), this.timeoutMs + 15000);
      sock.ev.on('creds.update', saveCreds);
      sock.ev.on('connection.update', async (update) => {
        if (done) return;
        if (update.qr && mode !== 'code') this.lastQr = update.qr;
        if ((update.qr || update.connection === 'connecting') && mode === 'code') await requestPairingCode();
        if (update.connection === 'open') {
          this.socketOpen = true;
          this.connected = true;
          this.connectionState = 'connected';
          this.lastQr = '';
          this.lastPairingCode = '';
          try { finish(await action(sock)); } catch (error) { finish({ status: 'error', provider: 'baileys', ...cleanConnectionError(error) }); }
        }
        if (update.connection === 'close') {
          this.socketOpen = false;
          this.connected = false;
          this.connectionState = this._sessionReady() ? 'session_ready' : 'setup_required';
          if (!keepUntilOpen) finish({ status: 'error', provider: 'baileys', ...cleanConnectionError(update.lastDisconnect?.error) });
        }
      });
      setTimeout(requestPairingCode, 1200);
    });
  }
}
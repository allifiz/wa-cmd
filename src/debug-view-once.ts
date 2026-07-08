#!/usr/bin/env node
import makeWASocket, { fetchLatestBaileysVersion, jidNormalizedUser, type proto, useMultiFileAuthState } from '@whiskeysockets/baileys';
import chalk from 'chalk';
import path from 'node:path';
import process from 'node:process';
import P from 'pino';
import qrcode from 'qrcode-terminal';

const ROOT = process.cwd();
const AUTH = path.join(ROOT, 'auth');
const logger = P({ level: 'silent' });

type WalkNode = { path: string; keys: string[]; flags: Record<string, unknown> };
type QuotedNode = { path: string; contextKeys: string[]; quoted: unknown };

function keysOf(value: unknown): string[] {
  return value && typeof value === 'object' ? Object.keys(value as Record<string, unknown>) : [];
}

function valueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function compactValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length}]`;
  if (value instanceof Uint8Array) return `[Uint8Array ${value.length}]`;
  if (Array.isArray(value)) return value.slice(0, 5).map(compactValue);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj).slice(0, 20)) {
      if (typeof v === 'object' && v !== null) out[k] = `[${valueType(v)} keys=${keysOf(v).join(',')}]`;
      else out[k] = v;
    }
    return out;
  }
  return value;
}

function walk(value: unknown, base = 'message', depth = 0): WalkNode[] {
  if (!value || typeof value !== 'object' || depth > 8) return [];
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  const flags: Record<string, unknown> = {};
  for (const k of keys) {
    if (/viewonce/i.test(k) || k === 'viewOnce' || k === 'mediaKey' || k === 'url' || k === 'mimetype') flags[k] = compactValue(obj[k]);
  }
  const nodes: WalkNode[] = [{ path: base, keys, flags }];
  for (const [k, v] of Object.entries(obj)) {
    if (!v || typeof v !== 'object') continue;
    nodes.push(...walk(v, `${base}.${k}`, depth + 1));
  }
  return nodes;
}

function findQuotedMessages(value: unknown, base = 'message', depth = 0): QuotedNode[] {
  if (!value || typeof value !== 'object' || depth > 10) return [];
  const obj = value as Record<string, unknown>;
  const found: QuotedNode[] = [];

  for (const [k, v] of Object.entries(obj)) {
    const pathHere = `${base}.${k}`;
    if (k === 'contextInfo' && v && typeof v === 'object') {
      const context = v as Record<string, unknown>;
      if (context.quotedMessage) found.push({ path: pathHere, contextKeys: Object.keys(context), quoted: context.quotedMessage });
    }
    found.push(...findQuotedMessages(v, pathHere, depth + 1));
  }

  return found;
}

function detectViewOnce(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  if (obj.viewOnce === true) return true;
  if (obj.viewOnceMessage || obj.viewOnceMessageV2 || obj.viewOnceMessageV2Extension) return true;
  return Object.values(obj).some((v) => detectViewOnce(v));
}

function getFirstMediaFlags(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  for (const key of ['imageMessage', 'videoMessage', 'documentMessage', 'audioMessage']) {
    const media = obj[key];
    if (media && typeof media === 'object') {
      const mediaObj = media as Record<string, unknown>;
      return {
        key,
        viewOnce: mediaObj.viewOnce,
        mimetype: mediaObj.mimetype,
        caption: mediaObj.caption,
        hasMediaKey: Boolean(mediaObj.mediaKey),
        hasUrl: Boolean(mediaObj.url),
      };
    }
  }
  for (const v of Object.values(obj)) {
    const found = getFirstMediaFlags(v);
    if (found) return found;
  }
  return null;
}

function unwrapMessage(m?: proto.IMessage | null): proto.IMessage | null {
  if (!m) return null;
  const anyMsg = m as any;
  const inner = anyMsg.ephemeralMessage?.message
    ?? anyMsg.viewOnceMessage?.message
    ?? anyMsg.viewOnceMessageV2?.message
    ?? anyMsg.viewOnceMessageV2Extension?.message
    ?? anyMsg.documentWithCaptionMessage?.message
    ?? null;
  return inner && inner !== m ? unwrapMessage(inner) : m;
}

function textOf(raw?: proto.IMessage | null): string {
  const m = unwrapMessage(raw);
  if (!m) return '';
  const anyMsg = m as any;
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage?.caption) return `[image] ${m.imageMessage.caption}`;
  if (m.videoMessage?.caption) return `[video] ${m.videoMessage.caption}`;
  if (m.imageMessage) return '[image]';
  if (m.videoMessage) return '[video]';
  if (m.audioMessage) return '[audio]';
  if (m.stickerMessage) return '[sticker]';
  if (m.documentMessage) return '[document]';
  if (anyMsg.protocolMessage) return '[protocol]';
  return '';
}

function printQuotedDebug(msg: proto.IMessage | null | undefined): void {
  const quotedMessages = findQuotedMessages(msg ?? {}, 'message');
  const summary = quotedMessages.map((item) => {
    const quoted = item.quoted;
    const quotedKeys = keysOf(quoted);
    const quotedFound = walk(quoted, item.path);
    return {
      path: item.path,
      contextKeys: item.contextKeys,
      quotedKeys,
      quotedDetectedViewOnce: detectViewOnce(quoted as proto.IMessage),
      quotedMediaFlags: getFirstMediaFlags(quoted),
      quotedTree: quotedFound.map((node) => ({ path: node.path, keys: node.keys, flags: node.flags })),
    };
  });

  console.log(chalk.magenta('quoted debug:'));
  console.log(JSON.stringify({ hasQuotedMessage: quotedMessages.length > 0, quotedCount: quotedMessages.length, summary }, null, 2));
}

function printMessage(raw: proto.IWebMessageInfo): void {
  const msg = raw.message;
  const rawObj = raw as unknown as Record<string, unknown>;
  const keyObj = raw.key as unknown as Record<string, unknown>;
  const at = Number(raw.messageTimestamp ?? Math.floor(Date.now() / 1000)) * 1000;
  const header = {
    time: new Date(at).toISOString(),
    remoteJid: raw.key.remoteJid,
    fromMe: raw.key.fromMe,
    id: raw.key.id,
    pushName: raw.pushName,
    outerKeys: Object.keys(rawObj),
    keyKeys: Object.keys(keyObj),
    keyIsViewOnce: keyObj.isViewOnce,
    topLevelKeys: keysOf(msg),
    messageType: valueType(msg),
    messageIsEmptyObject: Boolean(msg && typeof msg === 'object' && Object.keys(msg).length === 0),
    detectedViewOnce: detectViewOnce(msg),
    messageStubType: rawObj.messageStubType,
    messageStubParameters: rawObj.messageStubParameters,
    status: rawObj.status,
    text: textOf(msg),
    mediaFlags: getFirstMediaFlags(msg),
  };

  console.log(chalk.cyan('\n--- message debug ---'));
  console.log(JSON.stringify(header, null, 2));
  console.log(chalk.magenta('tree:'));
  console.log(JSON.stringify(walk(msg), null, 2));
  printQuotedDebug(msg);
}

async function connect(): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({ auth: state, version, logger, printQRInTerminal: false, browser: ['WA CMD Debug', 'Chrome', '0.1.0'], markOnlineOnConnect: false, syncFullHistory: false });

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', ({ connection, qr }) => {
    if (qr) { console.log(chalk.yellow('Scan QR ini pakai WhatsApp > Linked devices:')); qrcode.generate(qr, { small: true }); }
    if (connection === 'open') console.log(chalk.green('Debug connected ✓. Kirim/reply view-once sekarang. Ctrl+C untuk keluar.'));
  });

  sock.ev.on('messages.upsert', ({ messages }) => {
    for (const m of messages) printMessage(m);
  });
}

connect().catch((e) => {
  console.error(chalk.red(`Fatal: ${e instanceof Error ? e.message : String(e)}`));
  process.exit(1);
});

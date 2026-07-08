#!/usr/bin/env node
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, type proto, useMultiFileAuthState } from '@whiskeysockets/baileys';
import chalk from 'chalk';
import path from 'node:path';
import process from 'node:process';
import P from 'pino';
import qrcode from 'qrcode-terminal';

const ROOT = process.cwd();
const AUTH = path.join(ROOT, 'auth');
const logger = P({ level: 'silent' });

type FoundNode = {
  path: string;
  keys: string[];
  flags?: Record<string, unknown>;
};

type QuotedNode = {
  path: string;
  quoted: unknown;
  contextKeys: string[];
};

const interestingKeys = new Set([
  'message',
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'imageMessage',
  'videoMessage',
  'documentMessage',
  'documentWithCaptionMessage',
  'stickerMessage',
  'editedMessage',
  'protocolMessage',
  'messageContextInfo',
  'contextInfo',
  'quotedMessage',
  'extendedTextMessage',
]);

function keysOf(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  return Object.keys(value as Record<string, unknown>);
}

function valueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array(${value.length})`;
  return typeof value;
}

function pickFlags(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  const flags: Record<string, unknown> = {};
  for (const key of ['viewOnce', 'mimetype', 'caption', 'seconds', 'expiration', 'ephemeralSettingTimestamp', 'deviceListMetadataVersion']) {
    if (key in obj) flags[key] = obj[key];
  }
  for (const key of ['url', 'directPath', 'mediaKey', 'fileSha256', 'fileEncSha256', 'jpegThumbnail', 'thumbnailDirectPath', 'thumbnailSha256', 'thumbnailEncSha256', 'deviceListMetadata']) {
    if (key in obj) flags[`${key}Present`] = Boolean(obj[key]);
  }
  return Object.keys(flags).length ? flags : undefined;
}

function summarizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Buffer.isBuffer(value)) return `<Buffer ${value.length} bytes>`;
  if (Array.isArray(value)) return value.slice(0, 5).map(summarizeValue);
  if (typeof value !== 'object') return value;

  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(obj)) {
    if (['mediaKey', 'fileSha256', 'fileEncSha256', 'jpegThumbnail', 'thumbnailSha256', 'thumbnailEncSha256'].includes(key)) {
      out[`${key}Present`] = Boolean(child);
      continue;
    }
    if (['url', 'directPath', 'thumbnailDirectPath'].includes(key)) {
      out[`${key}Present`] = Boolean(child);
      continue;
    }
    if (typeof child === 'object' && child !== null) {
      out[key] = { type: valueType(child), keys: keysOf(child) };
      continue;
    }
    out[key] = child;
  }
  return out;
}

function walk(value: unknown, currentPath = 'message', depth = 0, found: FoundNode[] = []): FoundNode[] {
  if (!value || typeof value !== 'object' || depth > 10) return found;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);

  if (currentPath === 'message' || keys.some((key) => interestingKeys.has(key)) || keys.some((key) => key.toLowerCase().includes('viewonce'))) {
    found.push({ path: currentPath, keys, flags: pickFlags(obj) });
  }

  for (const [key, child] of Object.entries(obj)) {
    if (interestingKeys.has(key) || key.toLowerCase().includes('viewonce')) {
      walk(child, `${currentPath}.${key}`, depth + 1, found);
      continue;
    }

    if (key === 'message' && child && typeof child === 'object') {
      walk(child, `${currentPath}.${key}`, depth + 1, found);
    }
  }

  return found;
}

function detectViewOnce(msg?: proto.IMessage | null): boolean {
  const found = walk(msg ?? {}, 'message');
  return found.some((item) => item.path.toLowerCase().includes('viewonce') || item.flags?.viewOnce === true);
}

function findQuotedMessages(value: unknown, currentPath = 'message', depth = 0, found: QuotedNode[] = []): QuotedNode[] {
  if (!value || typeof value !== 'object' || depth > 10) return found;
  const obj = value as Record<string, unknown>;

  const contextInfo = obj.contextInfo;
  if (contextInfo && typeof contextInfo === 'object') {
    const context = contextInfo as Record<string, unknown>;
    if (context.quotedMessage) {
      found.push({
        path: `${currentPath}.contextInfo.quotedMessage`,
        quoted: context.quotedMessage,
        contextKeys: Object.keys(context),
      });
    }
  }

  for (const [key, child] of Object.entries(obj)) {
    if (child && typeof child === 'object') {
      const shouldDive = interestingKeys.has(key) || key.toLowerCase().includes('message') || key === 'contextInfo';
      if (shouldDive) findQuotedMessages(child, `${currentPath}.${key}`, depth + 1, found);
    }
  }

  return found;
}

function getFirstMediaFlags(msg: unknown): Record<string, unknown> | undefined {
  if (!msg || typeof msg !== 'object') return undefined;
  const obj = msg as Record<string, unknown>;
  for (const key of ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage']) {
    const media = obj[key];
    if (media && typeof media === 'object') {
      return { mediaKey: key, ...pickFlags(media) };
    }
  }

  for (const nestedKey of ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'ephemeralMessage', 'documentWithCaptionMessage']) {
    const nested = obj[nestedKey];
    if (nested && typeof nested === 'object') {
      const nestedMsg = (nested as Record<string, unknown>).message;
      const flags = getFirstMediaFlags(nestedMsg);
      if (flags) return flags;
    }
  }

  return undefined;
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
  const rawObj = raw as Record<string, unknown>;
  const keyObj = raw.key as Record<string, unknown>;
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
    participant: rawObj.participant,
  };

  console.log(chalk.cyan('\n=== messages.upsert ==='));
  console.log(JSON.stringify(header, null, 2));

  if (msg && typeof msg === 'object' && Object.keys(msg).length === 0) {
    console.log(chalk.red('message is empty object: event masuk, tapi isi media/text tidak dikirim ke session ini.'));
  }

  const found = walk(msg ?? {}, 'message');
  for (const item of found) {
    console.log(chalk.yellow(`- ${item.path}`));
    console.log(`  keys: ${item.keys.join(', ') || '(none)'}`);
    if (item.flags) console.log(`  flags: ${JSON.stringify(item.flags)}`);
  }

  printQuotedDebug(msg);

  console.log(chalk.gray('safe top-level summary:'));
  console.log(JSON.stringify(summarizeValue(rawObj), null, 2));
}

async function connect(): Promise<void> {
  console.log(chalk.cyan('Debug view-once + quoted-message mode. Pakai auth/ yang sama dengan wa-cmd.'));
  console.log(chalk.gray('Tes 1: kirim view-once baru ke akun ini.'));
  console.log(chalk.gray('Tes 2: dari HP utama akun ini, reply/quote view-once itu dengan teks bebas.'));
  console.log(chalk.gray('Yang dicari: quoted debug.hasQuotedMessage=true dan quotedMediaFlags punya mediaKey/directPath/urlPresent. Ctrl+C untuk keluar.'));

  const { state, saveCreds } = await useMultiFileAuthState(AUTH);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    auth: state,
    version,
    logger,
    printQRInTerminal: false,
    browser: ['WA CMD Debug', 'Chrome', '0.3.0'],
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log(chalk.yellow('Scan QR ini pakai WhatsApp > Linked devices:'));
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') console.log(chalk.green('Connected debug ✓'));

    if (connection === 'close') {
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
      console.log(chalk.red(`Connection closed. code=${code ?? 'unknown'}`));
      if (code === DisconnectReason.loggedOut) console.log(chalk.red('Logged out. Scan QR ulang kalau perlu.'));
      process.exit(code === DisconnectReason.loggedOut ? 1 : 0);
    }
  });

  sock.ev.on('messages.upsert', ({ messages }) => {
    for (const message of messages) printMessage(message);
  });
}

connect().catch((error) => {
  console.error(chalk.red(error instanceof Error ? error.stack ?? error.message : String(error)));
  process.exit(1);
});

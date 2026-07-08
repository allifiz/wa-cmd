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
]);

function keysOf(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  return Object.keys(value as Record<string, unknown>);
}

function pickFlags(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  const flags: Record<string, unknown> = {};
  for (const key of ['viewOnce', 'mimetype', 'caption', 'seconds']) {
    if (key in obj) flags[key] = obj[key];
  }
  for (const key of ['url', 'directPath', 'mediaKey', 'fileSha256', 'fileEncSha256', 'jpegThumbnail']) {
    if (key in obj) flags[`${key}Present`] = Boolean(obj[key]);
  }
  return Object.keys(flags).length ? flags : undefined;
}

function walk(value: unknown, currentPath = 'message', depth = 0, found: FoundNode[] = []): FoundNode[] {
  if (!value || typeof value !== 'object' || depth > 8) return found;
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

function printMessage(raw: proto.IWebMessageInfo): void {
  const msg = raw.message;
  const at = Number(raw.messageTimestamp ?? Math.floor(Date.now() / 1000)) * 1000;
  const header = {
    time: new Date(at).toISOString(),
    remoteJid: raw.key.remoteJid,
    fromMe: raw.key.fromMe,
    id: raw.key.id,
    pushName: raw.pushName,
    topLevelKeys: keysOf(msg),
    detectedViewOnce: detectViewOnce(msg),
  };

  console.log(chalk.cyan('\n=== messages.upsert ==='));
  console.log(JSON.stringify(header, null, 2));

  const found = walk(msg ?? {}, 'message');
  for (const item of found) {
    console.log(chalk.yellow(`- ${item.path}`));
    console.log(`  keys: ${item.keys.join(', ') || '(none)'}`);
    if (item.flags) console.log(`  flags: ${JSON.stringify(item.flags)}`);
  }
}

async function connect(): Promise<void> {
  console.log(chalk.cyan('Debug view-once mode. Pakai auth/ yang sama dengan wa-cmd.'));
  console.log(chalk.gray('Kirim foto biasa dan view-once baru ke akun ini, lalu bandingkan output-nya. Ctrl+C untuk keluar.'));

  const { state, saveCreds } = await useMultiFileAuthState(AUTH);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    auth: state,
    version,
    logger,
    printQRInTerminal: false,
    browser: ['WA CMD Debug', 'Chrome', '0.1.0'],
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

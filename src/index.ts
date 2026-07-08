#!/usr/bin/env node
import './quiet-logs.js';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  type AnyMessageContent,
  type proto,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import * as readline from 'node:readline/promises';
import P from 'pino';
import qrcode from 'qrcode-terminal';

type ChatItem = {
  jid: string;
  name: string;
  lastMessage: string;
  lastAt: number;
  unread: number;
};

type StoredMessage = {
  jid: string;
  fromMe: boolean;
  senderName: string;
  text: string;
  at: number;
};

type AliasStore = Record<string, string>;

const ROOT_DIR = process.cwd();
const AUTH_DIR = path.join(ROOT_DIR, 'auth');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const ALIAS_FILE = path.join(DATA_DIR, 'aliases.json');
const MAX_MESSAGES_PER_CHAT = 30;

const chats = new Map<string, ChatItem>();
const messages = new Map<string, StoredMessage[]>();
let currentChatJid: string | null = null;
let aliases: AliasStore = loadAliases();
let reconnecting = false;

const logger = P({ level: 'silent' });
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadAliases(): AliasStore {
  ensureDir(DATA_DIR);
  if (!fs.existsSync(ALIAS_FILE)) return {};

  try {
    return JSON.parse(fs.readFileSync(ALIAS_FILE, 'utf8')) as AliasStore;
  } catch {
    return {};
  }
}

function saveAliases(): void {
  ensureDir(DATA_DIR);
  fs.writeFileSync(ALIAS_FILE, `${JSON.stringify(aliases, null, 2)}\n`);
}

function printHeader(): void {
  console.clear();
  console.log(chalk.cyan.bold('WA CMD'));
  console.log(chalk.gray('WhatsApp ringan di terminal. Ketik /help untuk daftar command.'));
  console.log('');
}

function promptLabel(): string {
  if (!currentChatJid) return chalk.green('wa-cmd> ');
  const chat = chats.get(currentChatJid);
  return chalk.green(`${chat?.name ?? currentChatJid}> `);
}

function getMessageText(message?: proto.IMessage | null): string {
  if (!message) return '';

  const direct = message.conversation;
  const extended = message.extendedTextMessage?.text;
  const image = message.imageMessage?.caption;
  const video = message.videoMessage?.caption;
  const document = message.documentMessage?.caption;
  const button = message.buttonsResponseMessage?.selectedDisplayText;
  const list = message.listResponseMessage?.title;
  const template = message.templateButtonReplyMessage?.selectedDisplayText;

  if (direct) return direct;
  if (extended) return extended;
  if (image) return `[image] ${image}`;
  if (video) return `[video] ${video}`;
  if (document) return `[document] ${document}`;
  if (button) return `[button] ${button}`;
  if (list) return `[list] ${list}`;
  if (template) return `[template] ${template}`;
  if (message.imageMessage) return '[image]';
  if (message.videoMessage) return '[video]';
  if (message.audioMessage) return '[audio]';
  if (message.stickerMessage) return '[sticker]';
  if (message.documentMessage) return '[document]';

  return '[unsupported message]';
}

function displayTime(timestamp: number): string {
  return new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function normalizePhoneToJid(input: string): string {
  const cleaned = input.replace(/[^0-9]/g, '');
  if (!cleaned) throw new Error('Nomor kosong. Contoh: 6281234567890');
  return `${cleaned}@s.whatsapp.net`;
}

function getAliasForJid(jid: string): string | null {
  const entry = Object.entries(aliases).find(([, value]) => value === jid);
  return entry?.[0] ?? null;
}

function renderChatName(jid: string): string {
  const alias = getAliasForJid(jid);
  if (alias) return `@${alias}`;
  const chat = chats.get(jid);
  return chat?.name ?? jid;
}

function upsertChat(jid: string, name: string, text: string, fromMe: boolean, at: number): void {
  const old = chats.get(jid);
  chats.set(jid, {
    jid,
    name: old?.name && old.name !== jid ? old.name : name,
    lastMessage: text,
    lastAt: at,
    unread: fromMe || currentChatJid === jid ? 0 : (old?.unread ?? 0) + 1,
  });
}

function pushMessage(message: StoredMessage): void {
  const list = messages.get(message.jid) ?? [];
  list.push(message);
  messages.set(message.jid, list.slice(-MAX_MESSAGES_PER_CHAT));
}

function getSortedChats(): ChatItem[] {
  return [...chats.values()].sort((a, b) => b.lastAt - a.lastAt);
}

function printChats(filter?: string): void {
  const normalizedFilter = filter?.toLowerCase();
  const sorted = getSortedChats().filter((chat) => {
    if (!normalizedFilter) return true;
    const alias = getAliasForJid(chat.jid);
    return (
      chat.name.toLowerCase().includes(normalizedFilter) ||
      chat.jid.toLowerCase().includes(normalizedFilter) ||
      alias?.toLowerCase().includes(normalizedFilter)
    );
  });

  if (sorted.length === 0) {
    console.log(chalk.yellow('Belum ada chat tersimpan. Tunggu pesan masuk atau pakai /send nomor pesan.'));
    return;
  }

  for (const [index, chat] of sorted.entries()) {
    const unread = chat.unread > 0 ? chalk.yellow(` (${chat.unread})`) : '';
    const alias = getAliasForJid(chat.jid);
    const name = alias ? `${chat.name} ${chalk.gray(`@${alias}`)}` : chat.name;
    console.log(
      `${chalk.cyan(`[${index + 1}]`)} ${name}${unread} ${chalk.gray(displayTime(chat.lastAt))}\n    ${chalk.gray(chat.lastMessage)}`,
    );
  }
}

function resolveChatByIndex(raw: string): string | null {
  const index = Number(raw);
  if (!Number.isInteger(index) || index < 1) return null;
  return getSortedChats()[index - 1]?.jid ?? null;
}

function resolveTarget(raw: string): string {
  const value = raw.trim();
  if (!value) throw new Error('Target kosong. Pakai nomor, index chat, JID, atau @alias.');

  if (value.startsWith('@')) {
    const alias = value.slice(1).toLowerCase();
    const jid = aliases[alias];
    if (!jid) throw new Error(`Alias @${alias} belum ada.`);
    return jid;
  }

  const indexed = resolveChatByIndex(value);
  if (indexed) return indexed;

  if (value.includes('@s.whatsapp.net') || value.includes('@g.us')) return jidNormalizedUser(value);

  return normalizePhoneToJid(value);
}

function printConversation(jid: string): void {
  const chat = chats.get(jid);
  if (chat) chats.set(jid, { ...chat, unread: 0 });
  currentChatJid = jid;

  console.log(chalk.cyan(`\nMembuka chat: ${renderChatName(jid)}`));
  const list = messages.get(jid) ?? [];
  if (list.length === 0) {
    console.log(chalk.gray('Belum ada pesan lokal untuk chat ini.'));
    return;
  }

  for (const item of list) {
    const who = item.fromMe ? chalk.green('Kamu') : chalk.magenta(item.senderName || 'Dia');
    console.log(`${chalk.gray(displayTime(item.at))} ${who}: ${item.text}`);
  }
}

function printHelp(): void {
  console.log(`
${chalk.cyan.bold('Command utama')}
  /help                         tampilkan bantuan
  /chats                        lihat chat terakhir
  /search <kata>                cari chat berdasarkan nama/JID/alias
  /open <index|@alias|jid>      buka chat
  /close                        keluar dari chat aktif
  /send <target> <pesan>        kirim pesan ke nomor/index/@alias/JID
  /alias <index|jid|nomor> <a>  simpan alias lokal, contoh: /alias 1 raihan
  /aliases                      lihat daftar alias
  /logout                       hapus session WhatsApp lokal
  /clear                        bersihkan layar
  /exit                         keluar

${chalk.cyan.bold('Shortcut')}
  Saat chat sudah dibuka, ketik pesan biasa tanpa command untuk langsung mengirim.

${chalk.cyan.bold('Contoh')}
  /send 6281234567890 halo dari terminal
  /open 1
  /alias 1 bos
  /send @bos siap pak
`);
}

function printAliases(): void {
  const entries = Object.entries(aliases);
  if (entries.length === 0) {
    console.log(chalk.yellow('Belum ada alias. Buat dengan /alias 1 raihan'));
    return;
  }

  for (const [name, jid] of entries) {
    console.log(`${chalk.cyan(`@${name}`)} -> ${jid}`);
  }
}

async function sendText(sock: ReturnType<typeof makeWASocket>, jid: string, text: string): Promise<void> {
  const content: AnyMessageContent = { text };
  await sock.sendMessage(jid, content);
  const at = Date.now();
  upsertChat(jid, renderChatName(jid), text, true, at);
  pushMessage({ jid, fromMe: true, senderName: 'Kamu', text, at });
  console.log(chalk.green('sent ✓'));
}

async function handleCommand(sock: ReturnType<typeof makeWASocket>, line: string): Promise<void> {
  const [commandRaw, ...args] = line.trim().split(' ');
  const command = commandRaw.toLowerCase();

  switch (command) {
    case '/help':
      printHelp();
      return;

    case '/chats':
      printChats();
      return;

    case '/search':
      printChats(args.join(' '));
      return;

    case '/open': {
      const target = args.join(' ');
      const jid = resolveTarget(target);
      printConversation(jid);
      return;
    }

    case '/close':
      currentChatJid = null;
      console.log(chalk.gray('Chat ditutup.'));
      return;

    case '/send': {
      const target = args.shift();
      const text = args.join(' ');
      if (!target || !text) throw new Error('Format: /send <target> <pesan>');
      await sendText(sock, resolveTarget(target), text);
      return;
    }

    case '/alias': {
      const target = args.shift();
      const alias = args.shift()?.toLowerCase();
      if (!target || !alias) throw new Error('Format: /alias <index|jid|nomor> <alias>');
      if (!/^[a-z0-9_-]{2,30}$/.test(alias)) {
        throw new Error('Alias hanya boleh huruf kecil/angka/_/- minimal 2 karakter.');
      }

      const jid = resolveTarget(target);
      aliases[alias] = jid;
      saveAliases();
      console.log(chalk.green(`Alias @${alias} disimpan untuk ${jid}`));
      return;
    }

    case '/aliases':
      printAliases();
      return;

    case '/logout':
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      console.log(chalk.yellow('Session lokal dihapus. Jalankan ulang wa-cmd untuk scan QR lagi.'));
      process.exit(0);

    case '/clear':
      printHeader();
      return;

    case '/exit':
    case '/quit':
      console.log(chalk.gray('Bye.'));
      process.exit(0);

    default:
      console.log(chalk.yellow('Command tidak dikenal. Ketik /help.'));
  }
}

async function startPrompt(sock: ReturnType<typeof makeWASocket>): Promise<void> {
  while (true) {
    const line = (await rl.question(promptLabel())).trim();
    if (!line) continue;

    try {
      if (line.startsWith('/')) {
        await handleCommand(sock, line);
      } else if (currentChatJid) {
        await sendText(sock, currentChatJid, line);
      } else {
        console.log(chalk.yellow('Buka chat dulu dengan /open <index> atau kirim dengan /send <target> <pesan>.'));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(chalk.red(`Error: ${message}`));
    }
  }
}

async function connect(): Promise<void> {
  ensureDir(AUTH_DIR);
  ensureDir(DATA_DIR);

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    version,
    logger,
    printQRInTerminal: false,
    browser: ['WA CMD', 'Chrome', '0.1.0'],
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log(chalk.yellow('Scan QR ini pakai WhatsApp > Linked devices:'));
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      reconnecting = false;
      console.log(chalk.green('Connected ✓'));
      console.log(chalk.gray('Ketik /help untuk mulai.'));
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      if (shouldReconnect && !reconnecting) {
        reconnecting = true;
        console.log(chalk.yellow('Koneksi putus, mencoba reconnect...'));
        await connect();
      } else if (!shouldReconnect) {
        console.log(chalk.red('Logged out. Hapus folder auth lalu scan QR ulang.'));
        process.exit(1);
      }
    }
  });

  sock.ev.on('messages.upsert', ({ messages: incoming }) => {
    for (const item of incoming) {
      const remoteJid = item.key.remoteJid;
      if (!remoteJid || remoteJid === 'status@broadcast') continue;

      const fromMe = Boolean(item.key.fromMe);
      const text = getMessageText(item.message);
      if (!text) continue;

      const at = Number(item.messageTimestamp ?? Math.floor(Date.now() / 1000)) * 1000;
      const senderName = fromMe ? 'Kamu' : item.pushName || 'Dia';
      const name = item.pushName || renderChatName(remoteJid);

      upsertChat(remoteJid, name, text, fromMe, at);
      pushMessage({ jid: remoteJid, fromMe, senderName, text, at });

      if (!fromMe) {
        const chat = chats.get(remoteJid);
        const label = renderChatName(remoteJid);
        const prefix = currentChatJid === remoteJid ? chalk.magenta('\nnew') : chalk.cyan('\nnew');
        console.log(`${prefix} ${chalk.bold(label)} ${chalk.gray(displayTime(at))}: ${text}`);
        if (chat && currentChatJid === remoteJid) chats.set(remoteJid, { ...chat, unread: 0 });
      }
    }
  });

  await startPrompt(sock);
}

process.on('SIGINT', () => {
  console.log(chalk.gray('\nBye.'));
  process.exit(0);
});

printHeader();
connect().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(chalk.red(`Fatal: ${message}`));
  process.exit(1);
});

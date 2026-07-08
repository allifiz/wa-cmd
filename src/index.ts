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

type ContactItem = {
  jid: string;
  name: string;
  notify?: string;
  verifiedName?: string;
  updatedAt: number;
};

type AliasStore = Record<string, string>;
type ContactStore = Record<string, ContactItem>;

const ROOT_DIR = process.cwd();
const AUTH_DIR = path.join(ROOT_DIR, 'auth');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const ALIAS_FILE = path.join(DATA_DIR, 'aliases.json');
const CONTACTS_FILE = path.join(DATA_DIR, 'contacts.json');
const MAX_MESSAGES_PER_CHAT = 30;
const MAX_PRINTED_CONTACTS = 60;

const chats = new Map<string, ChatItem>();
const messages = new Map<string, StoredMessage[]>();
const contacts = new Map<string, ContactItem>();
let currentChatJid: string | null = null;
let aliases: AliasStore = loadAliases();
let reconnecting = false;

const logger = P({ level: 'silent' });
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

loadContactsIntoMemory();

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadJsonFile<T>(filePath: string, fallback: T): T {
  ensureDir(DATA_DIR);
  if (!fs.existsSync(filePath)) return fallback;

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function loadAliases(): AliasStore {
  return loadJsonFile<AliasStore>(ALIAS_FILE, {});
}

function saveAliases(): void {
  ensureDir(DATA_DIR);
  fs.writeFileSync(ALIAS_FILE, `${JSON.stringify(aliases, null, 2)}\n`);
}

function loadContactsIntoMemory(): void {
  const stored = loadJsonFile<ContactStore>(CONTACTS_FILE, {});
  for (const contact of Object.values(stored)) {
    if (contact.jid && contact.name) contacts.set(contact.jid, contact);
  }
}

function saveContacts(): void {
  ensureDir(DATA_DIR);
  const payload: ContactStore = {};
  for (const [jid, contact] of contacts.entries()) {
    payload[jid] = contact;
  }
  fs.writeFileSync(CONTACTS_FILE, `${JSON.stringify(payload, null, 2)}\n`);
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
  return chalk.green(`${chat?.name ?? renderChatName(currentChatJid)}> `);
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

function normalizeText(input: string): string {
  return input.trim().toLowerCase();
}

function normalizePhoneToJid(input: string): string {
  const cleaned = input.replace(/[^0-9]/g, '');
  if (!cleaned) throw new Error(`Target "${input}" belum ketemu. Pakai /chats, /contacts, nomor 628xxx, atau buat alias dengan /alias <index> <nama>.`);
  return `${cleaned}@s.whatsapp.net`;
}

function getAliasForJid(jid: string): string | null {
  const entry = Object.entries(aliases).find(([, value]) => value === jid);
  return entry?.[0] ?? null;
}

function getContactName(jid: string): string | null {
  const contact = contacts.get(jid);
  return contact?.name ?? contact?.notify ?? contact?.verifiedName ?? null;
}

function renderChatName(jid: string): string {
  const alias = getAliasForJid(jid);
  if (alias) return `@${alias}`;
  const contactName = getContactName(jid);
  if (contactName) return contactName;
  const chat = chats.get(jid);
  return chat?.name ?? jid;
}

function upsertContact(jid: string, rawName?: string | null, notify?: string | null, verifiedName?: string | null): void {
  const normalizedJid = jidNormalizedUser(jid);
  if (!normalizedJid || normalizedJid === 'status@broadcast') return;

  const old = contacts.get(normalizedJid);
  const fallbackName = old?.name ?? old?.notify ?? old?.verifiedName ?? normalizedJid;
  const name = rawName || notify || verifiedName || fallbackName;

  contacts.set(normalizedJid, {
    jid: normalizedJid,
    name,
    notify: notify ?? old?.notify,
    verifiedName: verifiedName ?? old?.verifiedName,
    updatedAt: Date.now(),
  });
}

function upsertChat(jid: string, name: string, text: string, fromMe: boolean, at: number): void {
  const old = chats.get(jid);
  upsertContact(jid, name);
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

function getMergedContacts(): ContactItem[] {
  const merged = new Map<string, ContactItem>();

  for (const [jid, contact] of contacts.entries()) {
    merged.set(jid, contact);
  }

  for (const chat of chats.values()) {
    const existing = merged.get(chat.jid);
    merged.set(chat.jid, {
      jid: chat.jid,
      name: existing?.name && existing.name !== chat.jid ? existing.name : chat.name,
      notify: existing?.notify,
      verifiedName: existing?.verifiedName,
      updatedAt: Math.max(existing?.updatedAt ?? 0, chat.lastAt),
    });
  }

  return [...merged.values()];
}

function getSortedContacts(filter?: string): ContactItem[] {
  const normalizedFilter = filter ? normalizeText(filter) : '';
  return getMergedContacts()
    .filter((contact) => {
      const alias = getAliasForJid(contact.jid);
      if (!normalizedFilter) return true;
      return (
        contact.name.toLowerCase().includes(normalizedFilter) ||
        contact.notify?.toLowerCase().includes(normalizedFilter) ||
        contact.verifiedName?.toLowerCase().includes(normalizedFilter) ||
        contact.jid.toLowerCase().includes(normalizedFilter) ||
        alias?.toLowerCase().includes(normalizedFilter)
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function printChats(filter?: string): void {
  const normalizedFilter = filter?.toLowerCase();
  const sorted = getSortedChats().filter((chat) => {
    if (!normalizedFilter) return true;
    const alias = getAliasForJid(chat.jid);
    const contactName = getContactName(chat.jid);
    return (
      chat.name.toLowerCase().includes(normalizedFilter) ||
      chat.jid.toLowerCase().includes(normalizedFilter) ||
      contactName?.toLowerCase().includes(normalizedFilter) ||
      alias?.toLowerCase().includes(normalizedFilter)
    );
  });

  if (sorted.length === 0) {
    console.log(chalk.yellow('Belum ada chat tersimpan. Coba /contacts atau tunggu pesan masuk.'));
    return;
  }

  for (const [index, chat] of sorted.entries()) {
    const unread = chat.unread > 0 ? chalk.yellow(` (${chat.unread})`) : '';
    const alias = getAliasForJid(chat.jid);
    const name = alias ? `${renderChatName(chat.jid)} ${chalk.gray(`@${alias}`)}` : renderChatName(chat.jid);
    console.log(
      `${chalk.cyan(`[${index + 1}]`)} ${name}${unread} ${chalk.gray(displayTime(chat.lastAt))}\n    ${chalk.gray(chat.lastMessage)}`,
    );
  }
}

function printContacts(filter?: string): void {
  const sorted = getSortedContacts(filter);

  if (sorted.length === 0) {
    console.log(chalk.yellow('Belum ada kontak/chat tersimpan. Tunggu pesan masuk atau kirim pakai nomor 628xxx.'));
    return;
  }

  const visible = sorted.slice(0, MAX_PRINTED_CONTACTS);
  for (const [index, contact] of visible.entries()) {
    const alias = getAliasForJid(contact.jid);
    const aliasText = alias ? chalk.gray(` @${alias}`) : '';
    const id = contact.jid.replace('@s.whatsapp.net', '').replace('@g.us', '').replace('@lid', '');
    const source = chats.has(contact.jid) ? chalk.gray(' chat') : chalk.gray(' contact');
    console.log(`${chalk.cyan(`[${index + 1}]`)} ${contact.name}${aliasText} ${chalk.gray(id)}${source}`);
  }

  if (sorted.length > visible.length) {
    console.log(chalk.gray(`Menampilkan ${visible.length}/${sorted.length}. Pakai /contacts <nama> untuk filter.`));
  }
}

function resolveChatByIndex(raw: string): string | null {
  const index = Number(raw);
  if (!Number.isInteger(index) || index < 1) return null;
  return getSortedChats()[index - 1]?.jid ?? null;
}

function resolveContactByIndex(raw: string): string | null {
  const index = Number(raw);
  if (!Number.isInteger(index) || index < 1) return null;
  return getSortedContacts()[index - 1]?.jid ?? null;
}

function resolveChatByName(raw: string): string | null {
  const value = normalizeText(raw);
  if (!value) return null;

  const sorted = getSortedChats();
  const exact = sorted.find((chat) => normalizeText(chat.name) === value || normalizeText(renderChatName(chat.jid)) === value);
  if (exact) return exact.jid;

  const partial = sorted.find((chat) => normalizeText(chat.name).includes(value) || normalizeText(renderChatName(chat.jid)).includes(value));
  return partial?.jid ?? null;
}

function resolveContactByName(raw: string): string | null {
  const value = normalizeText(raw);
  if (!value) return null;

  const sorted = getSortedContacts();
  const exact = sorted.find((contact) => normalizeText(contact.name) === value);
  if (exact) return exact.jid;

  const partial = sorted.find((contact) => normalizeText(contact.name).includes(value));
  return partial?.jid ?? null;
}

function resolveTarget(raw: string): string {
  const value = raw.trim();
  if (!value) throw new Error('Target kosong. Pakai nomor, index chat, nama kontak/chat, JID, atau @alias.');

  if (value.startsWith('@')) {
    const alias = value.slice(1).toLowerCase();
    const jid = aliases[alias];
    if (!jid) throw new Error(`Alias @${alias} belum ada.`);
    return jid;
  }

  const chatIndexed = resolveChatByIndex(value);
  if (chatIndexed) return chatIndexed;

  const contactIndexed = resolveContactByIndex(value);
  if (contactIndexed) return contactIndexed;

  if (value.includes('@s.whatsapp.net') || value.includes('@g.us') || value.includes('@lid')) return jidNormalizedUser(value);

  const namedChat = resolveChatByName(value);
  if (namedChat) return namedChat;

  const namedContact = resolveContactByName(value);
  if (namedContact) return namedContact;

  return normalizePhoneToJid(value);
}

function printConversation(jid: string): void {
  const chat = chats.get(jid);
  if (chat) chats.set(jid, { ...chat, unread: 0 });
  currentChatJid = jid;

  console.log(chalk.cyan(`\nMembuka chat: ${renderChatName(jid)}`));
  const list = messages.get(jid) ?? [];
  if (list.length === 0) {
    console.log(chalk.gray('Belum ada pesan lokal untuk chat ini. Pesan baru akan muncul setelah wa-cmd aktif.'));
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
  /contacts [nama]              lihat/cari kontak + chat tersimpan
  /search <kata>                cari chat berdasarkan nama/JID/alias
  /open <index|nama|@alias|jid> buka chat
  /close                        keluar dari chat aktif
  /send <target> <pesan>        kirim pesan ke nomor/index/nama/@alias/JID
  /alias <target> <alias>       simpan alias lokal, contoh: /alias 1 raihan
  /aliases                      lihat daftar alias
  /logout                       hapus session WhatsApp lokal
  /clear                        bersihkan layar
  /exit                         keluar

${chalk.cyan.bold('Shortcut')}
  Saat chat sudah dibuka, ketik pesan biasa tanpa command untuk langsung mengirim.

${chalk.cyan.bold('Contoh')}
  /contacts hina
  /chats
  /open hina
  /send hina halo dari terminal
  /send 6281234567890 halo dari terminal
  /alias 1 bot
  /send @bot siap
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
  saveContacts();
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

    case '/contacts':
      printContacts(args.join(' '));
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
      if (!target || !alias) throw new Error('Format: /alias <index|nama|jid|nomor> <alias>');
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
        console.log(chalk.yellow('Buka chat dulu dengan /open <index|nama> atau kirim dengan /send <target> <pesan>.'));
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

  sock.ev.on('contacts.upsert', (items: unknown[]) => {
    for (const raw of items) {
      const item = raw as { id?: string; jid?: string; name?: string; notify?: string; verifiedName?: string };
      const jid = item.id ?? item.jid;
      if (!jid) continue;
      upsertContact(jid, item.name, item.notify, item.verifiedName);
    }
    saveContacts();
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log(chalk.yellow('Scan QR ini pakai WhatsApp > Linked devices:'));
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      reconnecting = false;
      console.log(chalk.green('Connected ✓'));
      console.log(chalk.gray('Ketik /help untuk mulai. Pakai /contacts untuk lihat kontak/chat tersimpan.'));
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
      const senderName = fromMe ? 'Kamu' : item.pushName || renderChatName(remoteJid) || 'Dia';
      const name = item.pushName || renderChatName(remoteJid);

      upsertChat(remoteJid, name, text, fromMe, at);
      saveContacts();
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

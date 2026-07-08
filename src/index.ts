#!/usr/bin/env node
import './quiet-logs.js';
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, jidNormalizedUser, type AnyMessageContent, type proto, useMultiFileAuthState } from '@whiskeysockets/baileys';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import * as readline from 'node:readline/promises';
import P from 'pino';
import qrcode from 'qrcode-terminal';

type ChatItem = { jid: string; name: string; lastMessage: string; lastAt: number; unread: number };
type StoredMessage = { jid: string; fromMe: boolean; senderName: string; text: string; at: number };
type ContactItem = { jid: string; name: string; notify?: string; verifiedName?: string; updatedAt: number };
type AliasStore = Record<string, string>;
type ListItem = { jid: string; name: string; subtitle: string; source: 'chat' | 'contact' };
type Mode = 'inbox' | 'chat' | 'contacts' | 'search';

const ROOT = process.cwd();
const AUTH = path.join(ROOT, 'auth');
const DATA = path.join(ROOT, 'data');
const FILES = {
  aliases: path.join(DATA, 'aliases.json'),
  contacts: path.join(DATA, 'contacts.json'),
  chats: path.join(DATA, 'chats.json'),
  messages: path.join(DATA, 'messages.json'),
};
const PAGE_SIZE = 10;
const MAX_MSG = 80;

const chats = new Map<string, ChatItem>();
const contacts = new Map<string, ContactItem>();
const messages = new Map<string, StoredMessage[]>();
let aliases: AliasStore = {};
let mode: Mode = 'inbox';
let page = 0;
let filter = '';
let currentChat: string | null = null;
let activeList: ListItem[] = [];
let reconnecting = false;
let lastRender = 0;

const logger = P({ level: 'silent' });
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ensureData(): void {
  if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });
}

function readJson<T>(file: string, fallback: T): T {
  ensureData();
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return fallback; }
}

function writeJson(file: string, value: unknown): void {
  ensureData();
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function loadData(): void {
  aliases = readJson<AliasStore>(FILES.aliases, {});
  for (const c of Object.values(readJson<Record<string, ContactItem>>(FILES.contacts, {}))) if (c.jid) contacts.set(c.jid, c);
  for (const c of Object.values(readJson<Record<string, ChatItem>>(FILES.chats, {}))) if (c.jid) chats.set(c.jid, c);
  for (const [jid, list] of Object.entries(readJson<Record<string, StoredMessage[]>>(FILES.messages, {}))) messages.set(jid, list.slice(-MAX_MSG));
}

function saveData(): void {
  writeJson(FILES.aliases, aliases);
  writeJson(FILES.contacts, Object.fromEntries(contacts));
  writeJson(FILES.chats, Object.fromEntries(chats));
  writeJson(FILES.messages, Object.fromEntries([...messages.entries()].map(([jid, list]) => [jid, list.slice(-MAX_MSG)])));
}

function norm(s: string): string { return s.trim().toLowerCase(); }
function short(s: string, n = 50): string { return s.length <= n ? s : `${s.slice(0, n - 1)}…`; }
function time(ts: number): string { return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(new Date(ts)); }
function phoneToJid(s: string): string {
  const n = s.replace(/[^0-9]/g, '');
  if (!n) throw new Error(`Target "${s}" belum ketemu. Coba s <nama>, c <nama>, nomor 628xxx, atau @alias.`);
  return `${n}@s.whatsapp.net`;
}

function textOf(m?: proto.IMessage | null): string {
  if (!m) return '';
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage?.caption) return `[image] ${m.imageMessage.caption}`;
  if (m.videoMessage?.caption) return `[video] ${m.videoMessage.caption}`;
  if (m.documentMessage?.caption) return `[document] ${m.documentMessage.caption}`;
  if (m.buttonsResponseMessage?.selectedDisplayText) return `[button] ${m.buttonsResponseMessage.selectedDisplayText}`;
  if (m.listResponseMessage?.title) return `[list] ${m.listResponseMessage.title}`;
  if (m.imageMessage) return '[image]';
  if (m.videoMessage) return '[video]';
  if (m.audioMessage) return '[audio]';
  if (m.stickerMessage) return '[sticker]';
  if (m.documentMessage) return '[document]';
  return '[unsupported message]';
}

function aliasOf(jid: string): string | null { return Object.entries(aliases).find(([, v]) => v === jid)?.[0] ?? null; }
function contactName(jid: string): string | null {
  const c = contacts.get(jid);
  return c?.name ?? c?.notify ?? c?.verifiedName ?? null;
}
function nameOf(jid: string): string { const a = aliasOf(jid); return a ? `@${a}` : contactName(jid) ?? chats.get(jid)?.name ?? jid; }

function upsertContact(jid: string, name?: string | null, notify?: string | null, verifiedName?: string | null): void {
  const id = jidNormalizedUser(jid);
  if (!id || id === 'status@broadcast') return;
  const old = contacts.get(id);
  contacts.set(id, { jid: id, name: name || notify || verifiedName || old?.name || id, notify: notify ?? old?.notify, verifiedName: verifiedName ?? old?.verifiedName, updatedAt: Date.now() });
}

function upsertChat(jid: string, name: string, msg: string, fromMe: boolean, at: number): void {
  const old = chats.get(jid);
  upsertContact(jid, name);
  chats.set(jid, { jid, name: old?.name && old.name !== jid ? old.name : name, lastMessage: msg, lastAt: at, unread: fromMe || currentChat === jid ? 0 : (old?.unread ?? 0) + 1 });
}

function pushMsg(m: StoredMessage): void {
  const list = messages.get(m.jid) ?? [];
  list.push(m);
  messages.set(m.jid, list.slice(-MAX_MSG));
}

function sortedChats(): ChatItem[] { return [...chats.values()].sort((a, b) => b.lastAt - a.lastAt); }
function mergedContacts(): ContactItem[] {
  const m = new Map<string, ContactItem>(contacts);
  for (const ch of chats.values()) if (!m.has(ch.jid)) m.set(ch.jid, { jid: ch.jid, name: ch.name, updatedAt: ch.lastAt });
  return [...m.values()];
}

function matchContact(c: ContactItem, f: string): boolean {
  const q = norm(f); if (!q) return true;
  return [c.name, c.notify, c.verifiedName, c.jid, aliasOf(c.jid) ?? ''].some((x) => norm(x ?? '').includes(q));
}
function matchChat(c: ChatItem, f: string): boolean {
  const q = norm(f); if (!q) return true;
  return [c.name, nameOf(c.jid), c.jid, aliasOf(c.jid) ?? ''].some((x) => norm(x).includes(q));
}

function inboxList(f = ''): ListItem[] {
  return sortedChats().filter((c) => matchChat(c, f)).map((c) => ({ jid: c.jid, name: nameOf(c.jid), subtitle: `${c.unread ? `(${c.unread}) ` : ''}${c.lastMessage}`, source: 'chat' }));
}
function contactList(f = ''): ListItem[] {
  return mergedContacts().filter((c) => matchContact(c, f)).sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ jid: c.jid, name: nameOf(c.jid), subtitle: c.jid.replace('@s.whatsapp.net', '').replace('@g.us', '').replace('@lid', ''), source: chats.has(c.jid) ? 'chat' : 'contact' }));
}
function searchList(f: string): ListItem[] {
  const m = new Map<string, ListItem>();
  for (const x of inboxList(f)) m.set(x.jid, x);
  for (const x of contactList(f)) if (!m.has(x.jid)) m.set(x.jid, x);
  return [...m.values()];
}
function listForMode(): ListItem[] { return mode === 'contacts' ? contactList(filter) : mode === 'search' ? searchList(filter) : inboxList(filter); }
function maxPage(): number { return Math.max(0, Math.ceil(activeList.length / PAGE_SIZE) - 1); }
function pageItems(): ListItem[] { return activeList.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE); }

function renderHeader(): void {
  console.clear();
  console.log(chalk.cyan.bold('WA CMD'));
  console.log(chalk.gray('1-10 open | n/p page | s <nama> search | c <nama> contacts | r <no> <pesan> | b back | /help'));
  console.log('');
}
function renderList(): void {
  renderHeader();
  activeList = listForMode();
  page = Math.min(page, maxPage());
  const title = mode === 'contacts' ? `Contacts${filter ? `: ${filter}` : ''}` : mode === 'search' ? `Search: ${filter}` : 'Inbox';
  console.log(chalk.cyan.bold(`${title} page ${page + 1}/${maxPage() + 1}`));
  console.log('');
  const items = pageItems();
  if (!items.length) console.log(chalk.yellow('Kosong. Coba keyword lain, import VCF, atau tunggu pesan masuk.'));
  items.forEach((x, i) => { console.log(`${chalk.cyan(`[${i + 1}]`)} ${short(x.name, 30)} ${chalk.gray(x.source)}`); console.log(`    ${chalk.gray(short(x.subtitle, 60))}`); });
  console.log('');
}
function renderChat(): void {
  renderHeader();
  if (!currentChat) { mode = 'inbox'; renderList(); return; }
  const ch = chats.get(currentChat);
  if (ch) chats.set(currentChat, { ...ch, unread: 0 });
  console.log(chalk.cyan.bold(`Chat: ${nameOf(currentChat)}`));
  console.log(chalk.gray('Ketik pesan langsung. b/back kembali.'));
  console.log('');
  const list = (messages.get(currentChat) ?? []).slice(-30);
  if (!list.length) console.log(chalk.gray('Belum ada pesan lokal untuk chat ini.'));
  for (const m of list) console.log(`${chalk.gray(time(m.at))} ${m.fromMe ? chalk.green('kamu') : chalk.magenta(m.senderName || 'dia')}: ${m.text}`);
  console.log('');
}
function render(): void { lastRender = Date.now(); mode === 'chat' ? renderChat() : renderList(); }
function setMode(m: Mode, f = ''): void { mode = m; filter = f; page = 0; render(); }

function resolveIndex(raw: string): string | null {
  const i = Number(raw);
  if (!Number.isInteger(i) || i < 1 || i > PAGE_SIZE) return null;
  return pageItems()[i - 1]?.jid ?? null;
}
function resolveName(raw: string): string | null {
  const q = norm(raw); if (!q) return null;
  const chatsFound = sortedChats();
  const exactChat = chatsFound.find((c) => norm(c.name) === q || norm(nameOf(c.jid)) === q);
  if (exactChat) return exactChat.jid;
  const exactContact = mergedContacts().find((c) => norm(c.name) === q || norm(nameOf(c.jid)) === q);
  if (exactContact) return exactContact.jid;
  const partialChat = chatsFound.find((c) => norm(c.name).includes(q) || norm(nameOf(c.jid)).includes(q));
  if (partialChat) return partialChat.jid;
  const partialContact = mergedContacts().find((c) => norm(c.name).includes(q) || norm(nameOf(c.jid)).includes(q));
  return partialContact?.jid ?? null;
}
function resolveTarget(raw: string): string {
  const v = raw.trim();
  if (!v) throw new Error('Target kosong.');
  if (v.startsWith('@')) { const jid = aliases[v.slice(1).toLowerCase()]; if (!jid) throw new Error(`Alias ${v} belum ada.`); return jid; }
  const byIndex = resolveIndex(v); if (byIndex) return byIndex;
  if (v.includes('@s.whatsapp.net') || v.includes('@g.us') || v.includes('@lid')) return jidNormalizedUser(v);
  return resolveName(v) ?? phoneToJid(v);
}

function help(): void {
  console.log(`
${chalk.cyan.bold('Shortcut')}
  1-10                  buka item halaman aktif
  n / p                 next / prev page
  b / back              kembali ke inbox
  s <kata>              search chat + kontak
  c <kata>              filter contacts
  r <no> <pesan>        quick reply
  @alias <pesan>        quick send

${chalk.cyan.bold('Slash command')}
  /chats | /contacts [nama] | /search <kata> | /open <target>
  /send <target> <pesan> | /alias <target> <alias> | /aliases
  /clear | /logout | /exit
`);
}
function printAliases(): void { Object.entries(aliases).forEach(([a, j]) => console.log(`${chalk.cyan(`@${a}`)} -> ${nameOf(j)} ${chalk.gray(j)}`)); }

async function sendText(sock: ReturnType<typeof makeWASocket>, jid: string, text: string): Promise<void> {
  const content: AnyMessageContent = { text };
  await sock.sendMessage(jid, content);
  const at = Date.now();
  upsertChat(jid, nameOf(jid), text, true, at);
  pushMsg({ jid, fromMe: true, senderName: 'kamu', text, at });
  saveData();
  console.log(chalk.green('sent ✓'));
}

async function slash(sock: ReturnType<typeof makeWASocket>, line: string): Promise<void> {
  const [cmdRaw, ...args] = line.split(' '); const cmd = cmdRaw.toLowerCase();
  if (cmd === '/help') return help();
  if (cmd === '/chats') return setMode('inbox');
  if (cmd === '/contacts') return setMode('contacts', args.join(' '));
  if (cmd === '/search') return setMode('search', args.join(' '));
  if (cmd === '/open') { currentChat = resolveTarget(args.join(' ')); mode = 'chat'; return render(); }
  if (cmd === '/close' || cmd === '/back') { currentChat = null; return setMode('inbox'); }
  if (cmd === '/send') { const target = args.shift(); const text = args.join(' '); if (!target || !text) throw new Error('Format: /send <target> <pesan>'); return sendText(sock, resolveTarget(target), text); }
  if (cmd === '/alias') { const target = args.shift(); const alias = args.shift()?.toLowerCase(); if (!target || !alias) throw new Error('Format: /alias <target> <alias>'); aliases[alias] = resolveTarget(target); saveData(); console.log(chalk.green(`Alias @${alias} disimpan.`)); return; }
  if (cmd === '/aliases') return printAliases();
  if (cmd === '/clear') return render();
  if (cmd === '/logout') { fs.rmSync(AUTH, { recursive: true, force: true }); console.log(chalk.yellow('Session lokal dihapus. Jalankan ulang untuk scan QR.')); process.exit(0); }
  if (cmd === '/exit' || cmd === '/quit') process.exit(0);
  console.log(chalk.yellow('Command tidak dikenal. Ketik /help.'));
}

async function shortcut(sock: ReturnType<typeof makeWASocket>, line: string): Promise<void> {
  const lower = norm(line);
  if (lower === 'q' || lower === 'quit' || lower === 'exit') process.exit(0);
  if (lower === 'b' || lower === 'back') { currentChat = null; return setMode('inbox'); }
  if (lower === 'n' || lower === 'next') { activeList = listForMode(); page = Math.min(page + 1, maxPage()); return render(); }
  if (lower === 'p' || lower === 'prev') { page = Math.max(0, page - 1); return render(); }
  if ((/^[1-9]$|^10$/).test(line) && mode !== 'chat') { const jid = resolveIndex(line); if (!jid) throw new Error('Item tidak ada.'); currentChat = jid; mode = 'chat'; return render(); }
  if (lower === 's' || lower.startsWith('s ')) return setMode('search', line.slice(1).trim());
  if (lower === 'c' || lower.startsWith('c ')) return setMode('contacts', line.slice(1).trim());
  if (lower.startsWith('r ')) { const [, idx, ...msg] = line.split(' '); const jid = resolveIndex(idx); if (!jid || !msg.join(' ')) throw new Error('Format: r <no> <pesan>'); return sendText(sock, jid, msg.join(' ')); }
  if (line.startsWith('@')) { const [target, ...msg] = line.split(' '); if (!msg.join(' ')) throw new Error('Format: @alias <pesan>'); return sendText(sock, resolveTarget(target), msg.join(' ')); }
  if (mode === 'chat' && currentChat) return sendText(sock, currentChat, line);
  console.log(chalk.yellow('Tidak paham. Ketik /help.'));
}

async function promptLoop(sock: ReturnType<typeof makeWASocket>): Promise<void> {
  render();
  while (true) {
    const label = mode === 'chat' && currentChat ? `${nameOf(currentChat)}> ` : 'wa-cmd> ';
    const line = (await rl.question(chalk.green(label))).trim();
    if (!line) continue;
    try { line.startsWith('/') ? await slash(sock, line) : await shortcut(sock, line); } catch (e) { console.log(chalk.red(`Error: ${e instanceof Error ? e.message : String(e)}`)); }
  }
}

async function connect(): Promise<void> {
  ensureData();
  if (!fs.existsSync(AUTH)) fs.mkdirSync(AUTH, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(AUTH);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({ auth: state, version, logger, printQRInTerminal: false, browser: ['WA CMD', 'Chrome', '0.3.0'], markOnlineOnConnect: false, syncFullHistory: false });

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('contacts.upsert', (items: unknown[]) => { for (const raw of items) { const x = raw as { id?: string; jid?: string; name?: string; notify?: string; verifiedName?: string }; const jid = x.id ?? x.jid; if (jid) upsertContact(jid, x.name, x.notify, x.verifiedName); } saveData(); });
  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) { console.log(chalk.yellow('Scan QR ini pakai WhatsApp > Linked devices:')); qrcode.generate(qr, { small: true }); }
    if (connection === 'open') { reconnecting = false; render(); console.log(chalk.green('Connected ✓')); }
    if (connection === 'close') {
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut && !reconnecting) { reconnecting = true; console.log(chalk.yellow('Koneksi putus, reconnect...')); await connect(); }
      else if (code === DisconnectReason.loggedOut) { console.log(chalk.red('Logged out. Hapus auth lalu scan QR ulang.')); process.exit(1); }
    }
  });
  sock.ev.on('messages.upsert', ({ messages: incoming }) => {
    let changed = false;
    for (const m of incoming) {
      const jid = m.key.remoteJid;
      if (!jid || jid === 'status@broadcast') continue;
      const text = textOf(m.message); if (!text) continue;
      const fromMe = Boolean(m.key.fromMe);
      const at = Number(m.messageTimestamp ?? Math.floor(Date.now() / 1000)) * 1000;
      const senderName = fromMe ? 'kamu' : m.pushName || nameOf(jid);
      upsertChat(jid, m.pushName || nameOf(jid), text, fromMe, at);
      pushMsg({ jid, fromMe, senderName, text, at });
      changed = true;
      if (!fromMe && mode !== 'chat') console.log(`\n${chalk.cyan('new')} ${chalk.bold(nameOf(jid))} ${chalk.gray(time(at))}: ${text}`);
    }
    if (changed) { saveData(); if (Date.now() - lastRender > 1500 && (mode === 'inbox' || mode === 'chat')) render(); }
  });
  await promptLoop(sock);
}

loadData();
process.on('SIGINT', () => { saveData(); console.log(chalk.gray('\nBye.')); process.exit(0); });
connect().catch((e) => { console.error(chalk.red(`Fatal: ${e instanceof Error ? e.message : String(e)}`)); process.exit(1); });

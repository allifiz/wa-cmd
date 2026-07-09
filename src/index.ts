#!/usr/bin/env node
import './quiet-logs.js';
import makeWASocket, { DisconnectReason, downloadMediaMessage, fetchLatestBaileysVersion, jidNormalizedUser, type AnyMessageContent, type proto, useMultiFileAuthState } from '@whiskeysockets/baileys';
import chalk from 'chalk';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import * as readline from 'node:readline/promises';
import P from 'pino';
import qrcode from 'qrcode-terminal';

type ChatItem = { jid: string; name: string; lastMessage: string; lastAt: number; unread: number };
type StoredMessage = { jid: string; fromMe: boolean; senderName: string; text: string; at: number; seenAt?: number; censoredAt?: number; quote?: any };
type ContactItem = { jid: string; name: string; notify?: string; verifiedName?: string; updatedAt: number };
type AliasStore = Record<string, string>;
type JidLinkStore = Record<string, string>;
type LocalNameStore = Record<string, string>;
type SettingsStore = { viewOnceForwardJid?: string; messageCensorEnabled?: boolean };
type MediaKind = 'image' | 'view-once-image';
type MediaItem = { id: number; jid: string; kind: MediaKind; filePath: string; caption?: string; fromMe: boolean; senderName: string; at: number };
type MediaSaveResult = { text: string; item?: MediaItem };
type ListItem = { jid: string; name: string; subtitle: string; source: 'chat' | 'contact' };
type Mode = 'inbox' | 'chat' | 'contacts' | 'search';

const ROOT = process.cwd();
const AUTH = path.join(ROOT, 'auth');
const DATA = path.join(ROOT, 'data');
const IMAGE_DIR = path.join(DATA, 'media', 'images');
const VIEW_ONCE_DIR = path.join(IMAGE_DIR, 'view-once');
const FILES = {
  aliases: path.join(DATA, 'aliases.json'),
  jidLinks: path.join(DATA, 'jid-links.json'),
  localNames: path.join(DATA, 'local-names.json'),
  contacts: path.join(DATA, 'contacts.json'),
  chats: path.join(DATA, 'chats.json'),
  messages: path.join(DATA, 'messages.json'),
  media: path.join(DATA, 'media.json'),
  settings: path.join(DATA, 'settings.json'),
};
const PAGE_SIZE = 10;
const MAX_MSG = 80;
const CHAT_VIEW_LIMIT = 10;
const DUPLICATE_WINDOW_MS = 3000;
const NOTIFICATION_COOLDOWN_MS = 1200;
const MESSAGE_CENSOR_DELAY_MS = 5 * 60 * 1000;
const UNREAD_BANNER_TTL_MS = 5 * 60 * 1000;

const chats = new Map<string, ChatItem>();
const contacts = new Map<string, ContactItem>();
const messages = new Map<string, StoredMessage[]>();
const media = new Map<number, MediaItem>();
const jidLinks = new Map<string, string>();
let aliases: AliasStore = {};
let localNames: LocalNameStore = {};
let settings: SettingsStore = {};
let nextMediaId = 1;
let mode: Mode = 'inbox';
let page = 0;
let filter = '';
let currentChat: string | null = null;
let activeList: ListItem[] = [];
let activeChatMessages: StoredMessage[] = [];
let activeUnreadJids: string[] = [];
let pendingQuote: StoredMessage | null = null;
let reconnecting = false;
let lastRender = 0;
let lastNotificationAt = 0;
let censorTimer: NodeJS.Timeout | null = null;

const logger = P({ level: 'silent' });
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ensureDir(dir: string): void { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
function ensureData(): void { ensureDir(DATA); }
function ensureImages(): void { ensureDir(IMAGE_DIR); ensureDir(VIEW_ONCE_DIR); }
function readJson<T>(file: string, fallback: T): T { ensureData(); if (!fs.existsSync(file)) return fallback; try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return fallback; } }
function writeJson(file: string, value: unknown): void { ensureData(); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function norm(s: string): string { return s.trim().toLowerCase(); }
function short(s: string, n = 50): string { return s.length <= n ? s : `${s.slice(0, n - 1)}…`; }
function safeFilePart(s: string): string { return s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 48); }
function time(ts: number): string { return new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }).format(new Date(ts)); }
function isLidJid(jid: string): boolean { return jid.endsWith('@lid'); }
function isPhoneJid(jid: string): boolean { return jid.endsWith('@s.whatsapp.net'); }
function isOneToOneJid(jid: string): boolean { return isPhoneJid(jid) || isLidJid(jid); }
function phoneToJid(s: string): string { const n = s.replace(/[^0-9]/g, ''); if (!n) throw new Error(`Target "${s}" belum ketemu. Coba s <nama>, c <nama>, nomor 628xxx, atau @alias.`); return `${n}@s.whatsapp.net`; }

function rootJid(jid: string): string {
  let cur = jidNormalizedUser(jid);
  if (!cur) return jid;
  const seen = new Set<string>();
  while (jidLinks.has(cur) && !seen.has(cur)) { seen.add(cur); cur = jidLinks.get(cur) ?? cur; }
  return cur;
}
function isSameMessage(a: StoredMessage, b: StoredMessage): boolean { return a.jid === b.jid && a.fromMe === b.fromMe && a.text === b.text && Math.abs(a.at - b.at) <= DUPLICATE_WINDOW_MS; }
function dedupeMessageList(list: StoredMessage[]): StoredMessage[] { const clean: StoredMessage[] = []; for (const item of list.sort((a, b) => a.at - b.at)) { if (!item.text || item.text === '[unsupported message]') continue; if (!clean.some((old) => isSameMessage(old, item))) clean.push(item); } return clean.slice(-MAX_MSG); }
function latestMessageAt(jid: string, fromMe?: boolean): number { const list = messages.get(jid) ?? []; const filtered = fromMe === undefined ? list : list.filter((m) => m.fromMe === fromMe); return Math.max(0, ...filtered.map((m) => m.at)); }

function cleanupViewOnceFiles(): void { fs.rmSync(VIEW_ONCE_DIR, { recursive: true, force: true }); ensureDir(VIEW_ONCE_DIR); for (const [id, item] of media.entries()) if (item.kind === 'view-once-image') media.delete(id); writeJson(FILES.media, Object.fromEntries([...media.entries()].map(([id, item]) => [String(id), item]))); }
function saveData(): void { writeJson(FILES.aliases, aliases); writeJson(FILES.jidLinks, Object.fromEntries(jidLinks)); writeJson(FILES.localNames, localNames); writeJson(FILES.settings, settings); writeJson(FILES.contacts, Object.fromEntries(contacts)); writeJson(FILES.chats, Object.fromEntries(chats)); writeJson(FILES.messages, Object.fromEntries([...messages.entries()].map(([jid, list]) => [jid, dedupeMessageList(list)]))); writeJson(FILES.media, Object.fromEntries([...media.entries()].map(([id, item]) => [String(id), item]))); }
function exitApp(code = 0): never { saveData(); cleanupViewOnceFiles(); console.log(chalk.gray('\nBye.')); process.exit(code); }

function loadData(): void {
  aliases = readJson<AliasStore>(FILES.aliases, {});
  localNames = readJson<LocalNameStore>(FILES.localNames, {});
  settings = readJson<SettingsStore>(FILES.settings, {});
  for (const [from, to] of Object.entries(readJson<JidLinkStore>(FILES.jidLinks, {}))) { const a = jidNormalizedUser(from); const b = jidNormalizedUser(to); if (a && b && a !== b) jidLinks.set(a, b); }
  for (const c of Object.values(readJson<Record<string, ContactItem>>(FILES.contacts, {}))) if (c.jid) contacts.set(c.jid, c);
  for (const c of Object.values(readJson<Record<string, ChatItem>>(FILES.chats, {}))) if (c.jid) chats.set(c.jid, c);
  for (const [jid, list] of Object.entries(readJson<Record<string, StoredMessage[]>>(FILES.messages, {}))) messages.set(jid, dedupeMessageList(list));
  for (const item of Object.values(readJson<Record<string, MediaItem>>(FILES.media, {}))) if (item.id && item.filePath) media.set(item.id, item);
  repairJidLinksFromHistory();
  nextMediaId = Math.max(0, ...media.keys()) + 1;
}

function localNameOf(jidRaw: string): string | null { const jid = rootJid(jidRaw); return localNames[jid] ?? localNames[jidRaw] ?? null; }
function setLocalName(jidRaw: string, nameRaw: string): void { const jid = rootJid(jidRaw); const name = nameRaw.trim(); if (!name) throw new Error('Nama kosong. Format: /name [target] <nama>'); localNames[jid] = name; const ch = chats.get(jid); if (ch) chats.set(jid, { ...ch, name }); const c = contacts.get(jid); if (c) contacts.set(jid, { ...c, name, updatedAt: Date.now() }); saveData(); }
function removeLocalName(jidRaw: string): void { const jid = rootJid(jidRaw); delete localNames[jid]; saveData(); }
function aliasOf(jidRaw: string): string | null { const jid = rootJid(jidRaw); return Object.entries(aliases).find(([, v]) => rootJid(v) === jid)?.[0] ?? null; }
function contactName(jidRaw: string): string | null { const jid = rootJid(jidRaw); const c = contacts.get(jid) ?? contacts.get(jidRaw); return localNameOf(jid) ?? c?.name ?? c?.notify ?? c?.verifiedName ?? null; }
function nameOf(jidRaw: string): string { const jid = rootJid(jidRaw); const a = aliasOf(jid); return localNameOf(jid) ?? (a ? `@${a}` : contactName(jid) ?? chats.get(jid)?.name ?? jid); }
function searchableNames(jid: string): string[] { const c = contacts.get(jid); const ch = chats.get(jid); return [localNameOf(jid), c?.name, c?.notify, c?.verifiedName, ch?.name, aliasOf(jid)].filter(Boolean) as string[]; }

function mergeJidData(fromRaw: string, toRaw: string): string {
  const from = jidNormalizedUser(fromRaw);
  const to = jidNormalizedUser(toRaw);
  if (!from || !to || from === to) return to ?? from ?? fromRaw;
  const canonical = rootJid(to);
  if (from === canonical) return canonical;
  jidLinks.set(from, canonical);
  const fromChat = chats.get(from);
  const toChat = chats.get(canonical);
  if (fromChat || toChat) {
    const newest = !toChat || (fromChat && fromChat.lastAt > toChat.lastAt) ? fromChat : toChat;
    const preferredName = contactName(canonical) ?? aliasOf(canonical)?.replace(/^/, '@') ?? toChat?.name ?? fromChat?.name ?? canonical;
    chats.set(canonical, { jid: canonical, name: preferredName, lastMessage: newest?.lastMessage ?? '', lastAt: newest?.lastAt ?? Date.now(), unread: (toChat?.unread ?? 0) + (fromChat?.unread ?? 0) });
    chats.delete(from);
  }
  const fromMsgs = messages.get(from) ?? [];
  if (fromMsgs.length) { messages.set(canonical, dedupeMessageList([...(messages.get(canonical) ?? []), ...fromMsgs.map((m) => ({ ...m, jid: canonical }))])); messages.delete(from); }
  for (const item of media.values()) if (item.jid === from) item.jid = canonical;
  for (const [alias, jid] of Object.entries(aliases)) if (jid === from) aliases[alias] = canonical;
  for (const [jid, name] of Object.entries(localNames)) if (jid === from) { localNames[canonical] = localNames[canonical] ?? name; delete localNames[jid]; }
  if (settings.viewOnceForwardJid === from) settings.viewOnceForwardJid = canonical;
  if (currentChat === from) currentChat = canonical;
  return canonical;
}
function phoneJidFromValue(value: unknown): string | null { if (typeof value !== 'string') return null; const match = value.match(/\d{7,20}@s\.whatsapp\.net/); if (!match) return null; const jid = jidNormalizedUser(match[0]) ?? match[0]; return isPhoneJid(jid) ? jid : null; }
function uniquePhoneJids(values: unknown[]): string[] { return [...new Set(values.map(phoneJidFromValue).filter(Boolean) as string[])]; }
function findPayloadPhoneJid(raw: any): string | null { const key = raw?.key ?? {}; const directCandidates = uniquePhoneJids([key.senderPn, key.participantPn, key.participant, key.remoteJidAlt, key.remoteJidPn, raw?.senderPn, raw?.participantPn, raw?.participant]); return directCandidates.length === 1 ? directCandidates[0] : null; }
function findManualLinkedJid(id: string, pushName: string | undefined): string | null { const linked = rootJid(id); if (linked === id) return null; if (!isLidJid(id)) return linked; const push = norm(pushName ?? ''); const sameBareNumber = id.replace(/@lid$/, '') === linked.replace(/@s\.whatsapp\.net$/, ''); const nameMatches = Boolean(push && searchableNames(linked).some((name) => norm(name) === push)); if (sameBareNumber || nameMatches) return linked; jidLinks.delete(id); return null; }
function findLikelyCanonicalForIncoming(rawJid: string, pushName: string | undefined, raw?: any): string { const id = jidNormalizedUser(rawJid); if (!id) return rawJid; if (!isLidJid(id)) return rootJid(id); const payloadPhone = findPayloadPhoneJid(raw); if (payloadPhone) return mergeJidData(id, payloadPhone); const manual = findManualLinkedJid(id, pushName); if (manual) return manual; const push = norm(pushName ?? ''); if (push) { const matches = [...chats.keys(), ...contacts.keys()].map((jid) => rootJid(jid)).filter((jid, i, arr) => arr.indexOf(jid) === i && jid !== id && isPhoneJid(jid)).filter((jid) => searchableNames(jid).some((name) => norm(name) === push)); if (matches.length === 1) return mergeJidData(id, matches[0]); } return id; }
function repairJidLinksFromHistory(): void { for (const [from, to] of [...jidLinks.entries()]) { if (!isLidJid(from)) continue; const target = rootJid(to); if (!isPhoneJid(target) && !target.endsWith('@g.us')) jidLinks.delete(from); } }

function unwrapMessage(m?: proto.IMessage | null): proto.IMessage | null { if (!m) return null; const anyMsg = m as any; const inner = anyMsg.ephemeralMessage?.message ?? anyMsg.viewOnceMessage?.message ?? anyMsg.viewOnceMessageV2?.message ?? anyMsg.viewOnceMessageV2Extension?.message ?? anyMsg.documentWithCaptionMessage?.message ?? null; return inner && inner !== m ? unwrapMessage(inner) : m; }
function hasViewOnceWrapper(m?: proto.IMessage | null): boolean { if (!m) return false; const anyMsg = m as any; if (anyMsg.viewOnceMessage || anyMsg.viewOnceMessageV2 || anyMsg.viewOnceMessageV2Extension) return true; const inner = anyMsg.ephemeralMessage?.message ?? anyMsg.documentWithCaptionMessage?.message; return inner && inner !== m ? hasViewOnceWrapper(inner) : false; }
function isViewOnce(raw?: proto.IMessage | null): boolean { if (!raw) return false; const anyRaw = raw as any; const m = unwrapMessage(raw) as any; return Boolean(hasViewOnceWrapper(raw) || anyRaw.imageMessage?.viewOnce || anyRaw.videoMessage?.viewOnce || m?.imageMessage?.viewOnce || m?.videoMessage?.viewOnce); }
function payloadLooksViewOnce(value: unknown, depth = 0, seen = new WeakSet<object>()): boolean { if (!value || depth > 8) return false; if (typeof value === 'string') return /view.?once/i.test(value); if (typeof value === 'number' || typeof value === 'boolean') return false; if (typeof value !== 'object') return false; if (seen.has(value)) return false; seen.add(value); for (const [key, child] of Object.entries(value as Record<string, unknown>)) { if (/viewOnce|view_once|view-once/i.test(key)) return true; if ((key === 'messageStubType' || key === 'type') && /view.?once/i.test(String(child))) return true; if (payloadLooksViewOnce(child, depth + 1, seen)) return true; } return false; }
function textOf(raw?: proto.IMessage | null): string { const once = isViewOnce(raw); const m = unwrapMessage(raw); if (!m) return ''; const anyMsg = m as any; if (m.conversation) return m.conversation; if (m.extendedTextMessage?.text) return m.extendedTextMessage.text; if (m.imageMessage?.caption) return `[${once ? 'view-once image' : 'image'}] ${m.imageMessage.caption}`; if (m.videoMessage?.caption) return `[${once ? 'view-once video' : 'video'}] ${m.videoMessage.caption}`; if (m.documentMessage?.caption) return `[document] ${m.documentMessage.caption}`; if (m.buttonsResponseMessage?.selectedDisplayText) return `[button] ${m.buttonsResponseMessage.selectedDisplayText}`; if (m.listResponseMessage?.title) return `[list] ${m.listResponseMessage.title}`; if (anyMsg.templateButtonReplyMessage?.selectedDisplayText) return `[template] ${anyMsg.templateButtonReplyMessage.selectedDisplayText}`; if (m.imageMessage) return once ? '[view-once image]' : '[image]'; if (m.videoMessage) return once ? '[view-once video]' : '[video]'; if (m.audioMessage) return '[audio]'; if (m.stickerMessage) return '[sticker]'; if (m.documentMessage) return '[document]'; return ''; }
function getImageMessage(raw?: proto.IMessage | null): { caption?: string; once: boolean } | null { const once = isViewOnce(raw); const m = unwrapMessage(raw); if (!m?.imageMessage) return null; return { caption: m.imageMessage.caption ?? undefined, once }; }
function getContextInfo(raw?: proto.IMessage | null): any | null { const m = unwrapMessage(raw) as any; if (!m) return null; return m.extendedTextMessage?.contextInfo ?? m.imageMessage?.contextInfo ?? m.videoMessage?.contextInfo ?? m.documentMessage?.contextInfo ?? m.buttonsResponseMessage?.contextInfo ?? m.listResponseMessage?.contextInfo ?? null; }
function getQuotedMessage(rawMessage: any, jid: string): any | null { const context = getContextInfo(rawMessage?.message); const quotedMessage = context?.quotedMessage; if (!quotedMessage) return null; return { key: { remoteJid: jid, id: context.stanzaId, participant: context.participant, fromMe: false }, message: quotedMessage, messageTimestamp: rawMessage.messageTimestamp }; }
function viewOnceChatMarker(rawMessage?: unknown, senderName = 'user', fromMe = false, item?: MediaItem, mediaText?: string): string | null { const raw = rawMessage as any; const message = raw?.message ?? raw; const mediaLooksViewOnce = Boolean(mediaText && /view-once/i.test(mediaText)); const directLooksViewOnce = Boolean(message && (isViewOnce(message) || payloadLooksViewOnce(raw))); if (item?.kind !== 'view-once-image' && !mediaLooksViewOnce && !directLooksViewOnce) return null; const who = fromMe ? 'kamu' : (senderName.trim() || 'user'); const id = item?.kind === 'view-once-image' ? ` #v${item.id}` : ''; return `[${who} kirim view-once${id}]`; }
function getStickerMessage(raw?: proto.IMessage | null): boolean { return Boolean(unwrapMessage(raw)?.stickerMessage); }

function upsertContact(jid: string, name?: string | null, notify?: string | null, verifiedName?: string | null): void { const id = rootJid(jidNormalizedUser(jid) ?? jid); if (!id || id === 'status@broadcast') return; const old = contacts.get(id); contacts.set(id, { jid: id, name: name || notify || verifiedName || old?.name || id, notify: notify ?? old?.notify, verifiedName: verifiedName ?? old?.verifiedName, updatedAt: Date.now() }); }
function upsertChat(jidRaw: string, name: string, msg: string, fromMe: boolean, at: number): void { const jid = rootJid(jidRaw); const old = chats.get(jid); if (!fromMe) upsertContact(jid, name); const local = localNameOf(jid); const safeName = local ?? (fromMe ? (contactName(jid) ?? old?.name ?? jid) : (contactName(jid) ?? old?.name ?? name)); chats.set(jid, { jid, name: old?.name && old.name !== jid ? old.name : safeName, lastMessage: msg, lastAt: at, unread: fromMe || currentChat === jid ? 0 : (old?.unread ?? 0) + 1 }); }
function pushMsg(m: StoredMessage): void { const jid = rootJid(m.jid); if (!m.text || m.text === '[unsupported message]') return; const fixed = { ...m, jid }; const list = messages.get(jid) ?? []; if (list.some((old) => isSameMessage(old, fixed))) return; list.push(fixed); messages.set(jid, list.slice(-MAX_MSG)); }
function addMedia(item: Omit<MediaItem, 'id'>): MediaItem { const full: MediaItem = { ...item, jid: rootJid(item.jid), id: nextMediaId++ }; media.set(full.id, full); return full; }
async function saveIncomingImage(sock: ReturnType<typeof makeWASocket>, rawMessage: any, jid: string, fromMe: boolean, senderName: string, at: number): Promise<MediaSaveResult | null> { const directInfo = getImageMessage(rawMessage.message); const quotedRawMessage = directInfo ? null : getQuotedMessage(rawMessage, jid); const info = directInfo ?? getImageMessage(quotedRawMessage?.message); if (!info) return null; const downloadTarget = directInfo ? rawMessage : quotedRawMessage; const quoted = Boolean(quotedRawMessage); try { ensureImages(); const buffer = await downloadMediaMessage(downloadTarget, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage } as any) as Buffer; const kind: MediaKind = info.once ? 'view-once-image' : 'image'; const id = nextMediaId; const dir = info.once ? VIEW_ONCE_DIR : IMAGE_DIR; const prefix = quoted ? 'quoted-' : ''; const fileName = `${prefix}${info.once ? 'view-once' : 'image'}-${String(id).padStart(4, '0')}-${safeFilePart(jid)}-${at}.jpg`; const filePath = path.join(dir, fileName); fs.writeFileSync(filePath, buffer); const item = addMedia({ jid, kind, filePath, caption: info.caption, fromMe, senderName, at }); const label = info.once ? `${quoted ? 'quoted ' : ''}view-once image #v${item.id}` : `${quoted ? 'quoted ' : ''}image #${item.id}`; const caption = info.caption ? ` ${info.caption}` : ''; return { text: `[${label}]${caption}`, item }; } catch { const prefix = quoted ? 'quoted ' : ''; return { text: info.once ? `[${prefix}view-once image: gagal download]` : `[${prefix}image: gagal download]` }; } }

function messageCensorEnabled(): boolean { return settings.messageCensorEnabled !== false; }
function terminalCensorText(text: string): string { const normalized = text.replace(/[\r\n]+/g, ' ').trim(); const blocks = Math.max(8, Math.min(32, Math.ceil(normalized.length / 2))); return '[░░ SENSOR ░░] ' + '█'.repeat(blocks); }
function isTerminalCensored(m: StoredMessage): boolean { return Boolean(m.censoredAt || m.text.startsWith('[░░ SENSOR ░░]')); }
function refreshChatPreview(jidRaw: string): void { const jid = rootJid(jidRaw); const latest = (messages.get(jid) ?? []).at(-1); const ch = chats.get(jid); if (ch && latest) chats.set(jid, { ...ch, lastMessage: latest.text, lastAt: latest.at }); }
function censorDueMessages(force = false): void { if (!messageCensorEnabled()) return; const now = Date.now(); let changed = false; for (const [jid, list] of messages.entries()) { let touched = false; for (const m of list) { if (isTerminalCensored(m) || !m.seenAt) continue; if (!force && now - m.seenAt < MESSAGE_CENSOR_DELAY_MS) continue; m.text = terminalCensorText(m.text); m.censoredAt = now; touched = true; changed = true; } if (touched) refreshChatPreview(jid); } if (changed) { saveData(); render(); } }
function nextCensorDelay(): number { const now = Date.now(); let next = 0; for (const list of messages.values()) for (const m of list) { if (isTerminalCensored(m) || !m.seenAt) continue; const due = m.seenAt + MESSAGE_CENSOR_DELAY_MS; if (!next || due < next) next = due; } return next ? Math.max(1000, next - now) : 60_000; }
function scheduleCensorSweep(): void { if (censorTimer) clearTimeout(censorTimer); censorTimer = setTimeout(() => { censorDueMessages(); scheduleCensorSweep(); }, nextCensorDelay()); }
function markMessagesSeenForCensor(jidRaw: string): void { if (!messageCensorEnabled()) return; const jid = rootJid(jidRaw); const now = Date.now(); let changed = false; for (const m of messages.get(jid) ?? []) { if (isTerminalCensored(m) || m.seenAt) continue; m.seenAt = now; changed = true; } if (changed) { saveData(); scheduleCensorSweep(); } }
function markChatRepliedForCensor(jidRaw: string): void { markMessagesSeenForCensor(jidRaw); }
function censorStatus(): void { console.log(messageCensorEnabled() ? chalk.green('Message sensor ON. Pesan yang dibuka/dibalas akan disensor setelah 5 menit.') : chalk.yellow('Message sensor OFF.')); }
function censorCommand(args: string[]): void { const sub = args.shift()?.toLowerCase() ?? 'status'; if (sub === 'status') return censorStatus(); if (sub === 'on') { settings.messageCensorEnabled = true; saveData(); censorStatus(); scheduleCensorSweep(); return; } if (sub === 'off') { settings.messageCensorEnabled = false; saveData(); censorStatus(); return; } if (sub === 'now') { censorDueMessages(true); console.log(chalk.green('Pesan yang sudah ditandai dibuka/dibalas sudah disensor.')); return; } throw new Error('Format: /sensor status | on | off | now'); }

function sortedChats(): ChatItem[] { return [...chats.values()].filter((c) => c.lastMessage && c.lastMessage !== '[unsupported message]').sort((a, b) => b.lastAt - a.lastAt); }
function mergedContacts(): ContactItem[] { const m = new Map<string, ContactItem>(contacts); for (const ch of chats.values()) if (!m.has(ch.jid)) m.set(ch.jid, { jid: ch.jid, name: ch.name, updatedAt: ch.lastAt }); return [...m.values()]; }
function matchContact(c: ContactItem, f: string): boolean { const q = norm(f); if (!q) return true; return [c.name, c.notify, c.verifiedName, c.jid, aliasOf(c.jid) ?? ''].some((x) => norm(x ?? '').includes(q)); }
function matchChat(c: ChatItem, f: string): boolean { const q = norm(f); if (!q) return true; return [c.name, nameOf(c.jid), c.jid, aliasOf(c.jid) ?? ''].some((x) => norm(x).includes(q)); }
function inboxList(f = ''): ListItem[] { return sortedChats().filter((c) => matchChat(c, f)).map((c) => ({ jid: c.jid, name: nameOf(c.jid), subtitle: `${c.unread ? `(${c.unread}) ` : ''}${c.lastMessage}`, source: 'chat' })); }
function contactList(f = ''): ListItem[] { return mergedContacts().filter((c) => matchContact(c, f)).sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ jid: c.jid, name: nameOf(c.jid), subtitle: c.jid.replace('@s.whatsapp.net', '').replace('@g.us', '').replace('@lid', ''), source: chats.has(c.jid) ? 'chat' : 'contact' })); }
function searchList(f: string): ListItem[] { const m = new Map<string, ListItem>(); for (const x of inboxList(f)) m.set(x.jid, x); for (const x of contactList(f)) if (!m.has(x.jid)) m.set(x.jid, x); return [...m.values()]; }
function listForMode(): ListItem[] { return mode === 'contacts' ? contactList(filter) : mode === 'search' ? searchList(filter) : inboxList(filter); }
function maxPage(): number { return Math.max(0, Math.ceil(activeList.length / PAGE_SIZE) - 1); }
function pageItems(): ListItem[] { return activeList.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE); }
function unreadChatsForBanner(): ChatItem[] { const now = Date.now(); return sortedChats().filter((c) => c.unread > 0 && c.jid !== currentChat && now - c.lastAt <= UNREAD_BANNER_TTL_MS).slice(0, 5); }
function quotePreview(quote: any): string | null { if (!quote) return null; const text = textOf(quote.message as proto.IMessage) || (payloadLooksViewOnce(quote) ? '[view-once]' : '[quoted message]'); const who = quote.key?.fromMe ? 'kamu' : 'dia'; return `${who}: ${short(text.replace(/[\r\n]+/g, ' '), 64)}`; }
function isViewOnceMarkerText(text?: string): boolean { return Boolean(text && /view-once/i.test(text)); }
function quoteInfoFromRaw(raw: any, fallbackJid: string, fallbackText?: string): any | null { const key = raw?.key; const rawMessage = raw?.message; const fallbackIsViewOnceMarker = isViewOnceMarkerText(fallbackText); const rawLooksLikeViewOnce = Boolean(rawMessage && (isViewOnce(rawMessage) || payloadLooksViewOnce(rawMessage))); if (fallbackIsViewOnceMarker && !rawLooksLikeViewOnce) return null; const message = rawMessage ?? (fallbackText ? { conversation: fallbackText } : null); if (!key?.id || !message) return null; return { key: { remoteJid: rootJid(key.remoteJid ?? fallbackJid), fromMe: Boolean(key.fromMe), id: key.id, participant: key.participant }, message, messageTimestamp: raw?.messageTimestamp ?? Math.floor(Date.now() / 1000) }; }
function quoteIndexError(): Error { return new Error('Format: q <no> <pesan>. Nomor harus dari pesan yang terlihat di room chat.'); }
function unquoteableViewOnceError(): Error { return new Error('View-once ini cuma placeholder dari WhatsApp linked device, bukan payload media asli. CMD tidak bisa quote-reply untuk trigger simpan. Kalau marker berikutnya muncul dengan #v atau payload asli, baru bisa di-quote dari CMD; selain itu quote dari HP dulu.'); }
function resolveQuoteMessage(raw: string): StoredMessage { if (mode !== 'chat' || !currentChat) throw new Error('Quote reply hanya bisa dipakai di dalam room chat.'); const index = Number(raw); if (!Number.isInteger(index) || index < 1 || index > activeChatMessages.length) throw quoteIndexError(); const msg = activeChatMessages[index - 1]; if (!msg?.quote) { if (isViewOnceMarkerText(msg?.text)) throw unquoteableViewOnceError(); throw new Error('Pesan ini belum bisa di-quote. Coba quote pesan baru yang masuk setelah update fitur ini.'); } return msg; }
function resolveLastIncomingQuoteMessage(): StoredMessage { if (mode !== 'chat' || !currentChat) throw new Error('Quote reply hanya bisa dipakai di dalam room chat.'); const msg = [...activeChatMessages].reverse().find((m) => !m.fromMe); if (!msg) throw new Error('Belum ada pesan lawan chat di tampilan ini.'); if (!msg.quote) { if (isViewOnceMarkerText(msg.text)) throw unquoteableViewOnceError(); throw new Error('Pesan terakhir dari lawan chat belum bisa di-quote. Pakai q <no> untuk pilih pesan lain yang quoteable.'); } return msg; }
function setReplyMode(msg: StoredMessage): void { pendingQuote = msg; const preview = quotePreview(msg.quote) ?? msg.text; console.log(chalk.cyan(`Reply mode aktif → ${short(preview, 80)}`)); console.log(chalk.gray('Ketik pesan berikutnya untuk quote-reply. Ketik cancel untuk batal.')); }

function renderHeader(): void { console.clear(); console.log(chalk.cyan.bold(`WA CMD ${reconnecting ? chalk.yellow('○ reconnecting') : chalk.green('● connected')}`)); console.log(chalk.gray('1-10 open | j <target> jump | q <no> quote | reply <no> mode | n/p page | s/c search | v <media-id> | /help')); console.log(''); }
function renderUnreadBanner(): void { activeUnreadJids = []; const unread = unreadChatsForBanner(); if (!unread.length) return; console.log(chalk.yellow('Unread:')); unread.forEach((c, i) => { activeUnreadJids.push(c.jid); console.log(`  ${chalk.cyan(`j ${i + 1}`)} ${short(nameOf(c.jid), 24)} ${chalk.gray(`(${c.unread}) ${short(c.lastMessage, 48)}`)}`); }); console.log(chalk.gray('  Dibuka = hilang dari banner. Auto-hide setelah 5 menit.')); console.log(''); }
function renderList(): void { renderHeader(); activeChatMessages = []; activeList = listForMode(); page = Math.min(page, maxPage()); const title = mode === 'contacts' ? `Contacts${filter ? `: ${filter}` : ''}` : mode === 'search' ? `Search: ${filter}` : 'Inbox'; console.log(chalk.cyan.bold(`${title} page ${page + 1}/${maxPage() + 1}`)); console.log(''); const items = pageItems(); if (!items.length) console.log(chalk.yellow(mode === 'inbox' ? 'Inbox recent chat masih kosong. Pakai c <nama> untuk kontak, s <nama> untuk search, atau tunggu pesan masuk.' : 'Kosong. Coba keyword lain, import VCF, atau tunggu pesan masuk.')); items.forEach((x, i) => { console.log(`${chalk.cyan(`[${i + 1}]`)} ${short(x.name, 30)} ${chalk.gray(x.source)}`); console.log(`    ${chalk.gray(short(x.subtitle, 60))}`); }); console.log(''); }
function renderChat(): void { renderHeader(); if (!currentChat) { mode = 'inbox'; renderList(); return; } currentChat = rootJid(currentChat); const ch = chats.get(currentChat); if (ch) chats.set(currentChat, { ...ch, unread: 0 }); markMessagesSeenForCensor(currentChat); renderUnreadBanner(); console.log(chalk.cyan.bold(`Chat: ${nameOf(currentChat)}`)); if (pendingQuote) console.log(chalk.yellow(`Replying → ${short(quotePreview(pendingQuote.quote) ?? pendingQuote.text, 80)}`)); console.log(chalk.gray('Ketik pesan langsung. q <no> <pesan>, reply <no>, qq <pesan>, j <target>, b/back.')); console.log(''); const allMessages = dedupeMessageList(messages.get(currentChat) ?? []); const hiddenCount = Math.max(0, allMessages.length - CHAT_VIEW_LIMIT); const list = allMessages.slice(-CHAT_VIEW_LIMIT); activeChatMessages = list; if (hiddenCount) console.log(chalk.gray(`↑ ${hiddenCount} pesan lama disembunyikan. Tampilan hanya ${CHAT_VIEW_LIMIT} pesan terakhir.`)); if (!list.length) console.log(chalk.gray('Belum ada pesan lokal untuk chat ini.')); list.forEach((m, i) => { const preview = quotePreview(m.quote); if (preview) console.log(chalk.gray(`    ↪ ${preview}`)); console.log(`${chalk.cyan(`[${i + 1}]`)} ${chalk.gray(time(m.at))} ${m.fromMe ? chalk.green('kamu') : chalk.magenta(m.senderName || 'dia')}: ${m.censoredAt ? chalk.gray(m.text) : m.text}`); }); console.log(''); }
function render(): void { lastRender = Date.now(); mode === 'chat' ? renderChat() : renderList(); }
function setMode(m: Mode, f = ''): void { mode = m; filter = f; page = 0; pendingQuote = null; render(); }

function resolveIndex(raw: string): string | null { const i = Number(raw); if (!Number.isInteger(i) || i < 1 || i > PAGE_SIZE) return null; return pageItems()[i - 1]?.jid ?? null; }
function resolveName(raw: string): string | null { const q = norm(raw); if (!q) return null; const chatsFound = sortedChats(); const exactChat = chatsFound.find((c) => norm(c.name) === q || norm(nameOf(c.jid)) === q); if (exactChat) return exactChat.jid; const exactContact = mergedContacts().find((c) => norm(c.name) === q || norm(nameOf(c.jid)) === q); if (exactContact) return exactContact.jid; const partialChat = chatsFound.find((c) => norm(c.name).includes(q) || norm(nameOf(c.jid)).includes(q)); if (partialChat) return partialChat.jid; const partialContact = mergedContacts().find((c) => norm(c.name).includes(q) || norm(nameOf(c.jid)).includes(q)); return partialContact?.jid ?? null; }
function resolveTarget(raw: string): string { const v = raw.trim(); if (!v) throw new Error('Target kosong.'); if (v === '.' || v === 'this') { if (!currentChat) throw new Error('Tidak sedang di room chat.'); return currentChat; } if (v.startsWith('@')) { const jid = aliases[v.slice(1).toLowerCase()]; if (!jid) throw new Error(`Alias ${v} belum ada.`); return rootJid(jid); } const byIndex = mode !== 'chat' ? resolveIndex(v) : null; if (byIndex) return rootJid(byIndex); if (v.includes('@s.whatsapp.net') || v.includes('@g.us') || v.includes('@lid')) return rootJid(jidNormalizedUser(v) ?? v); return resolveName(v) ?? phoneToJid(v); }
function resolveJumpTarget(raw: string): string { const v = raw.trim(); const i = Number(v); if (mode === 'chat' && Number.isInteger(i) && i >= 1 && i <= activeUnreadJids.length) return rootJid(activeUnreadJids[i - 1]); return resolveTarget(v); }
function openChat(jidRaw: string): void { currentChat = rootJid(jidRaw); const ch = chats.get(currentChat); if (ch) chats.set(currentChat, { ...ch, unread: 0 }); pendingQuote = null; mode = 'chat'; render(); }
function linkJids(fromRaw: string, toRaw: string): void { const from = resolveTarget(fromRaw); const to = resolveTarget(toRaw); if (!isLidJid(from) && !isLidJid(rootJid(from))) throw new Error('Sumber link harus @lid / room LID. Contoh: /link 1 2'); const canonical = mergeJidData(from, to); saveData(); console.log(chalk.green(`Linked ${from} -> ${nameOf(canonical)} (${canonical})`)); render(); }

function help(): void { console.log(`
${chalk.cyan.bold('Shortcut')}
  1-10                  buka item halaman aktif
  j <nama/no>           jump / pindah chat cepat
  n / p                 next / prev page
  b / back              kembali ke inbox
  s <kata>              search chat + kontak
  c <kata>              filter contacts
  r <no> <pesan>        quick reply dari inbox
  q <no> <pesan>        quote reply pesan di room chat
  q <no> / reply <no>   masuk reply mode, lalu ketik pesan biasa
  qq <pesan>            quote reply pesan terakhir dari lawan chat
  v <media-id>          buka foto
  @alias <pesan>        quick send

${chalk.cyan.bold('Slash command')}
  /chats | /contacts [nama] | /search <kata> | /open <target> | /jump <target>
  /link <lid-target> <real-target> | /merge <lid-target> <real-target>
  /send <target> <pesan> | /reply <no> [pesan]
  /alias [target] <alias> | /aliases | /name [target] <nama> | /unname [target]
  /view <media-id> | /viewonce status | /viewonce set <target>
  /viewonce off | /viewonce list | /viewonce open <id>
  /sensor status | on | off | now
  /clear | /logout | /exit
`); }
function printAliases(): void { Object.entries(aliases).forEach(([a, j]) => console.log(`${chalk.cyan(`@${a}`)} -> ${nameOf(j)} ${chalk.gray(rootJid(j))}`)); }
function openPath(filePath: string): void { const resolved = path.resolve(filePath); const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open'; const args = process.platform === 'win32' ? ['/c', 'start', '', resolved] : [resolved]; spawn(command, args, { detached: true, stdio: 'ignore' }).unref(); }
function psQuote(s: string): string { return s.replace(/'/g, "''"); }
function terminalBell(): void { try { process.stdout.write('\x07'); } catch { /* ignore */ } }
function windowsBalloon(title: string, message: string): void { if (process.platform !== 'win32') return; const safeTitle = psQuote(short(title.replace(/[\r\n]+/g, ' '), 64)); const safeMessage = psQuote(short(message.replace(/[\r\n]+/g, ' '), 180)); const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Information
$notify.BalloonTipTitle = '${safeTitle}'
$notify.BalloonTipText = '${safeMessage}'
$notify.Visible = $true
$notify.ShowBalloonTip(4000)
Start-Sleep -Milliseconds 4500
$notify.Dispose()
`; const encoded = Buffer.from(script, 'utf16le').toString('base64'); spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], { detached: true, stdio: 'ignore' }).unref(); }
function notifyNewMessage(sender: string, message: string): void { const now = Date.now(); if (now - lastNotificationAt < NOTIFICATION_COOLDOWN_MS) return; lastNotificationAt = now; terminalBell(); windowsBalloon('WA CMD', `${sender}: ${message}`); }
function openMedia(idRaw: string): void { const cleaned = idRaw.trim().replace(/^#?v/i, ''); const id = Number(cleaned); if (!Number.isInteger(id)) throw new Error('Format: v <media-id>, contoh v1, v 7, vv12, atau v v12'); const item = media.get(id); if (!item) throw new Error(`Media #${id} tidak ketemu.`); if (!fs.existsSync(item.filePath)) throw new Error(`File media #${id} tidak ada di disk: ${item.filePath}`); openPath(item.filePath); console.log(chalk.green(`open media #${item.kind === 'view-once-image' ? `v${id}` : id}: ${item.filePath}`)); }

async function sendText(sock: ReturnType<typeof makeWASocket>, jidRaw: string, text: string): Promise<void> { const jid = rootJid(jidRaw); const sent = await sock.sendMessage(jid, { text } as AnyMessageContent); const at = Date.now(); upsertChat(jid, nameOf(jid), text, true, at); pushMsg({ jid, fromMe: true, senderName: 'kamu', text, at, quote: quoteInfoFromRaw(sent as any, jid, text) ?? undefined }); markChatRepliedForCensor(jid); saveData(); console.log(chalk.green('sent ✓')); }
async function sendQuotedText(sock: ReturnType<typeof makeWASocket>, jidRaw: string, quoted: StoredMessage, text: string): Promise<void> { const jid = rootJid(jidRaw); const clean = text.trim(); if (!clean) throw new Error('Pesan kosong. Format: q <no> <pesan>'); const sent = await sock.sendMessage(jid, { text: clean }, { quoted: quoted.quote } as any); const at = Date.now(); upsertChat(jid, nameOf(jid), clean, true, at); pushMsg({ jid, fromMe: true, senderName: 'kamu', text: clean, at, quote: quoteInfoFromRaw(sent as any, jid, clean) ?? undefined }); markChatRepliedForCensor(jid); pendingQuote = null; saveData(); console.log(chalk.green('quoted reply sent ✓')); }
async function forwardViewOnceIfEnabled(sock: ReturnType<typeof makeWASocket>, item?: MediaItem): Promise<void> { if (!item || item.kind !== 'view-once-image') return; const target = settings.viewOnceForwardJid ? rootJid(settings.viewOnceForwardJid) : undefined; if (!target || !fs.existsSync(item.filePath)) return; const sent = await sock.sendMessage(target, { image: fs.readFileSync(item.filePath), caption: item.caption ? `View-once dari ${nameOf(item.jid)}:\n${item.caption}` : `View-once dari ${nameOf(item.jid)}` }); const label = `[forwarded view-once #v${item.id}] ke ${nameOf(target)}`; const at = Date.now(); upsertChat(target, nameOf(target), label, true, at); pushMsg({ jid: target, fromMe: true, senderName: 'kamu', text: label, at, quote: quoteInfoFromRaw(sent as any, target, label) ?? undefined }); console.log(chalk.green(`anti-viewonce: forwarded to ${nameOf(target)} ✓`)); }
function viewOnceStatus(): void { const target = settings.viewOnceForwardJid ? rootJid(settings.viewOnceForwardJid) : undefined; const count = [...media.values()].filter((x) => x.kind === 'view-once-image').length; if (target) { console.log(chalk.green(`Anti-viewonce aktif. Auto-forward target: ${nameOf(target)} ${chalk.gray(target)}. Tersimpan sesi ini: ${count}.`)); return; } console.log(chalk.yellow(`Anti-viewonce aktif untuk simpan lokal, auto-forward off. Tersimpan sesi ini: ${count}.`)); }
function listViewOnce(): void { const items = [...media.values()].filter((x) => x.kind === 'view-once-image').sort((a, b) => b.at - a.at); if (!items.length) { console.log(chalk.yellow('Belum ada view-once tersimpan. Kirim view-once saat wa-cmd aktif, atau reply/quote view-once dari HP dengan teks apa pun.')); return; } for (const item of items.slice(0, 20)) console.log(`${chalk.cyan(`#v${item.id}`)} ${time(item.at)} ${nameOf(item.jid)} ${chalk.gray(item.caption ?? '')}`); }
function viewOnceCommand(args: string[]): void { const sub = args.shift()?.toLowerCase() ?? 'status'; if (sub === 'status') return viewOnceStatus(); if (sub === 'list') return listViewOnce(); if (sub === 'open' || sub === 'view') return openMedia(args[0] ?? ''); if (sub === 'set') { const target = args.join(' '); if (!target) throw new Error('Format: /viewonce set <target>'); settings.viewOnceForwardJid = resolveTarget(target); saveData(); console.log(chalk.green(`Auto-forward view-once diset ke ${nameOf(settings.viewOnceForwardJid)}.`)); return; } if (sub === 'off' || sub === 'disable') { delete settings.viewOnceForwardJid; saveData(); console.log(chalk.yellow('Auto-forward view-once dimatikan. View-once tetap disimpan lokal selama app hidup.')); return; } throw new Error('Format: /viewonce status | set <target> | off | list | open <id>'); }

async function slash(sock: ReturnType<typeof makeWASocket>, line: string): Promise<void> { const [cmdRaw, ...args] = line.split(' '); const cmd = cmdRaw.toLowerCase(); if (cmd === '/help') return help(); if (cmd === '/chats') return setMode('inbox'); if (cmd === '/contacts') return setMode('contacts', args.join(' ')); if (cmd === '/search') return setMode('search', args.join(' ')); if (cmd === '/open') return openChat(resolveTarget(args.join(' '))); if (cmd === '/jump' || cmd === '/j') return openChat(resolveJumpTarget(args.join(' '))); if (cmd === '/link' || cmd === '/merge') { const from = args.shift(); const to = args.join(' '); if (!from || !to) throw new Error('Format: /link <lid-target> <real-target>. Contoh: /link 1 2'); return linkJids(from, to); } if (cmd === '/close' || cmd === '/back') { currentChat = null; return setMode('inbox'); } if (cmd === '/send') { const target = args.shift(); const text = args.join(' '); if (!target || !text) throw new Error('Format: /send <target> <pesan>'); return sendText(sock, resolveTarget(target), text); } if (cmd === '/reply' || cmd === '/quote') { const idx = args.shift(); const text = args.join(' '); if (!currentChat || !idx) throw new Error('Format: /reply <no> [pesan]'); const msg = resolveQuoteMessage(idx); if (!text) return setReplyMode(msg); return sendQuotedText(sock, currentChat, msg, text); } if (cmd === '/alias') { const target = args.length >= 2 ? args.shift() : undefined; const alias = args.shift()?.toLowerCase(); const jid = target ? resolveTarget(target) : currentChat; if (!jid || !alias) throw new Error('Format: /alias <target> <alias> atau /alias <alias> di room chat'); aliases[alias] = rootJid(jid); saveData(); console.log(chalk.green(`Alias @${alias} disimpan.`)); return; } if (cmd === '/aliases') return printAliases(); if (cmd === '/name') { const target = args.length >= 2 ? args.shift() : undefined; const name = args.join(' '); const jid = target ? resolveTarget(target) : currentChat; if (!jid || !name) throw new Error('Format: /name [target] <nama>'); setLocalName(jid, name); console.log(chalk.green(`Nama lokal disimpan: ${name}`)); return render(); } if (cmd === '/unname') { const target = args.join(' '); const jid = target ? resolveTarget(target) : currentChat; if (!jid) throw new Error('Format: /unname [target]'); removeLocalName(jid); console.log(chalk.yellow('Nama lokal dihapus.')); return render(); } if (cmd === '/view') return openMedia(args[0] ?? ''); if (cmd === '/viewonce' || cmd === '/vo') return viewOnceCommand(args); if (cmd === '/sensor') return censorCommand(args); if (cmd === '/clear') return render(); if (cmd === '/logout') { cleanupViewOnceFiles(); fs.rmSync(AUTH, { recursive: true, force: true }); console.log(chalk.yellow('Session lokal dihapus. Jalankan ulang untuk scan QR.')); process.exit(0); } if (cmd === '/exit' || cmd === '/quit') exitApp(0); console.log(chalk.yellow('Command tidak dikenal. Ketik /help.')); }
async function shortcut(sock: ReturnType<typeof makeWASocket>, line: string): Promise<void> { const lower = norm(line); if (lower === 'cancel' || lower === 'x') { pendingQuote = null; console.log(chalk.yellow('Reply mode dibatalkan.')); return; } if (lower === 'q' || lower === 'quit' || lower === 'exit') exitApp(0); if (lower === 'b' || lower === 'back') { currentChat = null; return setMode('inbox'); } if (lower === 'n' || lower === 'next') { activeList = listForMode(); page = Math.min(page + 1, maxPage()); return render(); } if (lower === 'p' || lower === 'prev') { page = Math.max(0, page - 1); return render(); } if ((/^[1-9]$|^10$/).test(line) && mode !== 'chat') { const jid = resolveIndex(line); if (!jid) throw new Error('Item tidak ada.'); return openChat(jid); } if (lower === 's' || lower.startsWith('s ')) return setMode('search', line.slice(1).trim()); if (lower === 'c' || lower.startsWith('c ')) return setMode('contacts', line.slice(1).trim()); if (lower.startsWith('j ')) return openChat(resolveJumpTarget(line.slice(2).trim())); if (lower.startsWith('r ')) { const [, idx, ...msg] = line.split(' '); const jid = resolveIndex(idx); if (!jid || !msg.join(' ')) throw new Error('Format: r <no> <pesan>'); return sendText(sock, jid, msg.join(' ')); } if (lower.startsWith('qq ')) { if (!currentChat) throw new Error('qq hanya bisa dipakai di room chat.'); return sendQuotedText(sock, currentChat, resolveLastIncomingQuoteMessage(), line.slice(3).trim()); } if (lower.startsWith('q ') || lower.startsWith('qr ')) { if (!currentChat) throw new Error('q hanya bisa dipakai di room chat.'); const parts = line.split(' '); parts.shift(); const idx = parts.shift(); const text = parts.join(' '); if (!idx) throw quoteIndexError(); const msg = resolveQuoteMessage(idx); if (!text) return setReplyMode(msg); return sendQuotedText(sock, currentChat, msg, text); } if (lower.startsWith('reply ')) { if (!currentChat) throw new Error('reply hanya bisa dipakai di room chat.'); const [, idx, ...msg] = line.split(' '); if (!idx) throw quoteIndexError(); const quoted = resolveQuoteMessage(idx); const text = msg.join(' '); if (!text) return setReplyMode(quoted); return sendQuotedText(sock, currentChat, quoted, text); } if (lower.startsWith('v ') || /^vv?\d+$/.test(lower)) return openMedia(lower.startsWith('v ') ? line.slice(1).trim() : line); if (lower === 'vo') return viewOnceStatus(); if (lower.startsWith('vo ')) return viewOnceCommand(line.slice(2).trim().split(/\s+/).filter(Boolean)); if (line.startsWith('@')) { const [target, ...msg] = line.split(' '); if (!msg.join(' ')) throw new Error('Format: @alias <pesan>'); return sendText(sock, resolveTarget(target), msg.join(' ')); } if (mode === 'chat' && currentChat) { if (pendingQuote) return sendQuotedText(sock, currentChat, pendingQuote, line); return sendText(sock, currentChat, line); } console.log(chalk.yellow('Tidak paham. Ketik /help.')); }
async function promptLoop(sock: ReturnType<typeof makeWASocket>): Promise<void> { render(); while (true) { const label = mode === 'chat' && currentChat ? `${nameOf(currentChat)}${pendingQuote ? ' ↪' : ''}> ` : 'wa-cmd> '; const line = (await rl.question(chalk.green(label))).trim(); if (!line) continue; try { line.startsWith('/') ? await slash(sock, line) : await shortcut(sock, line); } catch (e) { console.log(chalk.red(`Error: ${e instanceof Error ? e.message : String(e)}`)); } } }

async function connect(): Promise<void> {
  ensureData(); ensureImages(); ensureDir(AUTH);
  const { state, saveCreds } = await useMultiFileAuthState(AUTH);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({ auth: state, version, logger, printQRInTerminal: false, browser: ['WA CMD', 'Chrome', '0.4.1'], markOnlineOnConnect: false, syncFullHistory: false });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('contacts.upsert', (items: unknown[]) => { for (const raw of items) { const x = raw as { id?: string; jid?: string; name?: string; notify?: string; verifiedName?: string }; const jid = x.id ?? x.jid; if (jid) upsertContact(jid, x.name, x.notify, x.verifiedName); } saveData(); });
  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => { if (qr) { console.log(chalk.yellow('Scan QR ini pakai WhatsApp > Linked devices:')); qrcode.generate(qr, { small: true }); } if (connection === 'open') { reconnecting = false; render(); console.log(chalk.green('Connected ✓')); } if (connection === 'close') { const code = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode; if (code !== DisconnectReason.loggedOut && !reconnecting) { reconnecting = true; console.log(chalk.yellow('Koneksi putus, reconnect...')); await connect(); } else if (code === DisconnectReason.loggedOut) { cleanupViewOnceFiles(); console.log(chalk.red('Logged out. Hapus auth lalu scan QR ulang.')); process.exit(1); } } });
  sock.ev.on('messages.upsert', async ({ messages: incoming }) => { let changed = false; for (const m of incoming) { const rawJid = m.key.remoteJid; if (!rawJid || rawJid === 'status@broadcast') continue; const fromMe = Boolean(m.key.fromMe); const at = Number(m.messageTimestamp ?? Math.floor(Date.now() / 1000)) * 1000; const senderName = fromMe ? 'kamu' : m.pushName || nameOf(rawJid); const jid = fromMe ? rootJid(rawJid) : findLikelyCanonicalForIncoming(rawJid, m.pushName, m as any); if (!isOneToOneJid(jid) && jid.includes('@newsletter')) continue; const chatName = fromMe ? nameOf(jid) : (contactName(jid) ?? m.pushName ?? nameOf(jid)); const mediaResult = await saveIncomingImage(sock, m as any, jid, fromMe, senderName, at); if (mediaResult?.item?.kind === 'view-once-image') await forwardViewOnceIfEnabled(sock, mediaResult.item); const text = viewOnceChatMarker(m as any, senderName, fromMe, mediaResult?.item, mediaResult?.text) ?? mediaResult?.text ?? textOf(m.message) ?? (getStickerMessage(m.message) ? '[sticker]' : ''); if (!text) continue; upsertChat(jid, chatName, text, fromMe, at); pushMsg({ jid, fromMe, senderName, text, at, quote: quoteInfoFromRaw(m as any, jid, text) ?? undefined }); changed = true; if (!fromMe && currentChat !== jid) notifyNewMessage(nameOf(jid), text); if (!fromMe && mode !== 'chat') console.log(`\n${chalk.cyan('new')} ${chalk.bold(nameOf(jid))} ${chalk.gray(time(at))}: ${text}`); } if (changed) { saveData(); if (Date.now() - lastRender > 1500 && (mode === 'inbox' || mode === 'chat')) render(); } });
  await promptLoop(sock);
}

loadData();
censorDueMessages();
scheduleCensorSweep();
process.on('SIGINT', () => exitApp(0));
connect().catch((e) => { cleanupViewOnceFiles(); console.error(chalk.red(`Fatal: ${e instanceof Error ? e.message : String(e)}`)); process.exit(1); });

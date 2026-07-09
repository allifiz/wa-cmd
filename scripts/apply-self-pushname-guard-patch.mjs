#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), 'src', 'index.ts');
let src = fs.readFileSync(file, 'utf8');
let changed = false;

function patch(label, from, to) {
  if (src.includes(to)) return;
  if (!src.includes(from)) {
    console.error(`Target patch tidak ketemu: ${label}`);
    process.exit(1);
  }
  src = src.replace(from, to);
  changed = true;
}

function ensureSettingsField(field) {
  if (src.includes(field)) return;
  const start = src.indexOf('type SettingsStore = {');
  const end = start >= 0 ? src.indexOf('};', start) : -1;
  if (start === -1 || end === -1) {
    console.error(`Target patch tidak ketemu: SettingsStore ${field}`);
    process.exit(1);
  }
  src = `${src.slice(0, end)}; ${field}${src.slice(end)}`;
  changed = true;
}
ensureSettingsField('selfPushNames?: string[]');

const helpers = "const DEFAULT_SELF_PUSH_NAMES = ['allif'];\nfunction selfPushNames(): string[] { return [...DEFAULT_SELF_PUSH_NAMES, ...(settings.selfPushNames ?? [])].filter(Boolean); }\nfunction isSelfPushName(value?: string | null): boolean { const decoded = decodeDisplayName(value) ?? value ?? ''; const n = norm(decoded); return Boolean(n && selfPushNames().some((x) => norm(x) === n)); }\nfunction rememberSelfPushName(value?: string | null): void { const decoded = decodeDisplayName(value)?.trim(); if (!decoded) return; const list = settings.selfPushNames ?? []; if (!list.some((x) => norm(x) === norm(decoded))) settings.selfPushNames = [...list, decoded]; }\nfunction safePushNameForJid(_jidRaw: string, pushName?: string | null): string | null { return decodeDisplayName(pushName)?.trim() || null; }\nfunction safeChatPushNameForJid(jidRaw: string, pushName?: string | null): string | null { const decoded = safePushNameForJid(jidRaw, pushName); if (!decoded || isSelfPushName(decoded)) return null; return decoded; }\nfunction safeIncomingChatName(jidRaw: string, pushName?: string | null): string { const jid = rootJid(jidRaw); const old = chats.get(jid)?.name; const oldSafe = old && old !== jid && !isSelfPushName(old) ? old : undefined; return contactName(jid) ?? safeChatPushNameForJid(jid, pushName) ?? oldSafe ?? jid; }\nfunction repairSelfNamedLidChats(): void { let touched = false; for (const [jid, chat] of [...chats.entries()]) { if (isLidJid(jid) && isSelfPushName(chat.name) && !localNameOf(jid)) { chats.set(jid, { ...chat, name: jid }); touched = true; } } for (const [jid, contact] of [...contacts.entries()]) { if (isLidJid(jid) && isSelfPushName(contact.name) && !localNameOf(jid)) { contacts.delete(jid); touched = true; } } if (touched) saveData(); }\nfunction selfNameCommand(args: string[]): void { const raw = args.join(' ').trim(); if (!raw) { console.log(chalk.cyan(`Self pushName guard: ${selfPushNames().join(', ')}`)); return; } const name = raw.replace(/^(add|set)\\s+/i, '').trim(); if (!name) throw new Error('Format: /selfname <nama kamu>, contoh: /selfname Allif'); rememberSelfPushName(name); repairSelfNamedLidChats(); saveData(); console.log(chalk.green(`Nama profile sendiri tetap tampil sebagai pushName, tapi tidak dijadikan nama permanen chat LID: ${name}`)); render(); }";

if (!src.includes('function isSelfPushName(')) {
  const marker = 'function searchableNames';
  const pos = src.indexOf(marker);
  if (pos === -1) {
    console.error('Target patch tidak ketemu: insert self pushName helpers');
    process.exit(1);
  }
  src = `${src.slice(0, pos)}${helpers}\n${src.slice(pos)}`;
  changed = true;
} else {
  const start = src.indexOf('const DEFAULT_SELF_PUSH_NAMES');
  const end = src.indexOf('function searchableNames', start);
  if (start !== -1 && end !== -1 && !src.includes('function safeChatPushNameForJid(')) {
    src = `${src.slice(0, start)}${helpers}\n${src.slice(end)}`;
    changed = true;
  }
}

if (!src.includes('repairSelfNamedLidChats(); nextMediaId =')) {
  if (src.includes('repairJidLinksFromHistory(); normalizeLinkedCaches(); nextMediaId =')) {
    src = src.replace('repairJidLinksFromHistory(); normalizeLinkedCaches(); nextMediaId =', 'repairJidLinksFromHistory(); normalizeLinkedCaches(); repairSelfNamedLidChats(); nextMediaId =');
    changed = true;
  } else if (src.includes('repairJidLinksFromHistory(); nextMediaId =')) {
    src = src.replace('repairJidLinksFromHistory(); nextMediaId =', 'repairJidLinksFromHistory(); repairSelfNamedLidChats(); nextMediaId =');
    changed = true;
  } else if (!src.includes('repairSelfNamedLidChats();')) {
    console.warn('loadData self-name repair target tidak ketemu; lanjut tanpa stop.');
  }
}

const oldUpsert = "function upsertChat(jidRaw: string, name: string, msg: string, fromMe: boolean, at: number): void { const jid = rootJid(jidRaw); const old = chats.get(jid); if (!fromMe) upsertContact(jid, name); const local = localNameOf(jid); const safeName = local ?? (fromMe ? (contactName(jid) ?? old?.name ?? jid) : (contactName(jid) ?? old?.name ?? name)); chats.set(jid, { jid, name: old?.name && old.name !== jid ? old.name : safeName, lastMessage: msg, lastAt: at, unread: fromMe || currentChat === jid ? 0 : (old?.unread ?? 0) + 1 }); }";
const newUpsert = "function upsertChat(jidRaw: string, name: string, msg: string, fromMe: boolean, at: number): void { const jid = rootJid(jidRaw); const old = chats.get(jid); if (!fromMe && !isSelfPushName(name)) upsertContact(jid, name); const local = localNameOf(jid); const oldName = old?.name && old.name !== jid && !isSelfPushName(old.name) ? old.name : undefined; const incomingName = !isSelfPushName(name) ? name : jid; const safeName = local ?? (fromMe ? (contactName(jid) ?? oldName ?? jid) : (contactName(jid) ?? oldName ?? incomingName)); chats.set(jid, { jid, name: safeName, lastMessage: msg, lastAt: at, unread: fromMe || currentChat === jid ? 0 : (old?.unread ?? 0) + 1 }); }";
if (!src.includes('!fromMe && !isSelfPushName(name)')) {
  patch('upsertChat ignore self pushName as permanent name', oldUpsert, newUpsert);
}

const oldMsgOrder = "const senderName = fromMe ? 'kamu' : m.pushName || nameOf(rawJid); const jid = fromMe ? rootJid(rawJid) : findLikelyCanonicalForIncoming(rawJid, m.pushName, m as any);";
const newMsgOrder = "if (fromMe) rememberSelfPushName(m.pushName); const jid = fromMe ? rootJid(rawJid) : findLikelyCanonicalForIncoming(rawJid, m.pushName, m as any); const senderName = fromMe ? 'kamu' : safePushNameForJid(jid, m.pushName) ?? nameOf(jid);";
if (!src.includes('safePushNameForJid(jid, m.pushName)')) {
  patch('message sender name keeps pushName display', oldMsgOrder, newMsgOrder);
}

const oldChatName = "const chatName = fromMe ? nameOf(jid) : (contactName(jid) ?? m.pushName ?? nameOf(jid));";
const newChatName = "const chatName = fromMe ? nameOf(jid) : safeIncomingChatName(jid, m.pushName);";
if (!src.includes('safeIncomingChatName(jid, m.pushName)')) {
  patch('incoming chat name safe pushName', oldChatName, newChatName);
}

const slashMarker = "if (cmd === '/sensor') return censorCommand(args);";
const slashReplacement = "if (cmd === '/sensor') return censorCommand(args); if (cmd === '/selfname' || cmd === '/me') return selfNameCommand(args);";
if (!src.includes("cmd === '/selfname'")) {
  patch('selfname command', slashMarker, slashReplacement);
}

const helpMarker = "  /sensor status | on | off | now\n  /clear | /logout | /exit";
const helpReplacement = "  /sensor status | on | off | now\n  /selfname <nama kamu> | /me <nama kamu>\n  /clear | /logout | /exit";
if (!src.includes('/selfname <nama kamu>')) {
  patch('help selfname command', helpMarker, helpReplacement);
}

if (changed) {
  fs.writeFileSync(file, src);
  console.log('patched: pushName stays visible but self-name is not cached as chat name.');
} else {
  console.log('self pushName guard already patched.');
}

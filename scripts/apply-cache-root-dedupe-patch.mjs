#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), 'src', 'index.ts');
let src = fs.readFileSync(file, 'utf8');
let changed = false;

const normalizeFn = "function normalizeLinkedCaches(): void { let touched = false; const nextChats = new Map<string, ChatItem>(); for (const [key, chat] of chats.entries()) { const jid = rootJid(key); const old = nextChats.get(jid); const newest = !old || chat.lastAt >= old.lastAt ? chat : old; const name = localNameOf(jid) ?? contactName(jid) ?? (old?.name && old.name !== old.jid ? old.name : undefined) ?? (chat.name && chat.name !== chat.jid ? chat.name : undefined) ?? jid; nextChats.set(jid, { jid, name, lastMessage: newest.lastMessage, lastAt: newest.lastAt, unread: (old?.unread ?? 0) + chat.unread }); if (jid !== key || chat.jid !== jid) touched = true; } chats.clear(); for (const [jid, chat] of nextChats.entries()) chats.set(jid, chat); const nextMessages = new Map<string, StoredMessage[]>(); for (const [key, list] of messages.entries()) { const jid = rootJid(key); const merged = [...(nextMessages.get(jid) ?? []), ...list.map((m) => ({ ...m, jid }))]; nextMessages.set(jid, dedupeMessageList(merged)); if (jid !== key) touched = true; } messages.clear(); for (const [jid, list] of nextMessages.entries()) messages.set(jid, list); const nextContacts = new Map<string, ContactItem>(); for (const [key, contact] of contacts.entries()) { const jid = rootJid(key); const old = nextContacts.get(jid); const name = localNameOf(jid) ?? old?.name ?? contact.name ?? old?.notify ?? contact.notify ?? old?.verifiedName ?? contact.verifiedName ?? jid; nextContacts.set(jid, { jid, name, notify: old?.notify ?? contact.notify, verifiedName: old?.verifiedName ?? contact.verifiedName, updatedAt: Math.max(old?.updatedAt ?? 0, contact.updatedAt ?? 0) }); if (jid !== key || contact.jid !== jid) touched = true; } contacts.clear(); for (const [jid, contact] of nextContacts.entries()) contacts.set(jid, contact); for (const item of media.values()) { const jid = rootJid(item.jid); if (jid !== item.jid) { item.jid = jid; touched = true; } } for (const [alias, jid] of Object.entries(aliases)) { const root = rootJid(jid); if (root !== jid) { aliases[alias] = root; touched = true; } } for (const [jid, name] of Object.entries(localNames)) { const root = rootJid(jid); if (root !== jid) { localNames[root] = localNames[root] ?? name; delete localNames[jid]; touched = true; } } if (currentChat) currentChat = rootJid(currentChat); if (touched) saveData(); }";

if (!src.includes('function normalizeLinkedCaches(): void')) {
  const marker = 'function repairJidLinksFromHistory(): void';
  const pos = src.indexOf(marker);
  if (pos === -1) {
    console.error('Target patch tidak ketemu: insert normalize linked caches');
    process.exit(1);
  }
  src = `${src.slice(0, pos)}${normalizeFn}\n${src.slice(pos)}`;
  changed = true;
}

if (!src.includes('repairJidLinksFromHistory(); normalizeLinkedCaches();')) {
  const old = 'repairJidLinksFromHistory(); nextMediaId =';
  if (!src.includes(old)) {
    console.error('Target patch tidak ketemu: call normalize linked caches');
    process.exit(1);
  }
  src = src.replace(old, 'repairJidLinksFromHistory(); normalizeLinkedCaches(); nextMediaId =');
  changed = true;
}

const oldSorted = "function sortedChats(): ChatItem[] { return [...chats.values()].filter((c) => c.lastMessage && c.lastMessage !== '[unsupported message]').sort((a, b) => b.lastAt - a.lastAt); }";
const newSorted = "function sortedChats(): ChatItem[] { const byRoot = new Map<string, ChatItem>(); for (const raw of chats.values()) { const jid = rootJid(raw.jid); if (!raw.lastMessage || raw.lastMessage === '[unsupported message]') continue; const c = { ...raw, jid }; const old = byRoot.get(jid); if (!old) byRoot.set(jid, c); else { const newest = c.lastAt >= old.lastAt ? c : old; byRoot.set(jid, { ...newest, jid, unread: old.unread + c.unread }); } } return [...byRoot.values()].sort((a, b) => b.lastAt - a.lastAt); }";
if (!src.includes('const byRoot = new Map<string, ChatItem>();')) {
  if (!src.includes(oldSorted)) {
    console.error('Target patch tidak ketemu: dedupe sorted chats');
    process.exit(1);
  }
  src = src.replace(oldSorted, newSorted);
  changed = true;
}

const oldSearch = "function searchList(f: string): ListItem[] { const m = new Map<string, ListItem>(); for (const x of inboxList(f)) m.set(x.jid, x); for (const x of contactList(f)) if (!m.has(x.jid)) m.set(x.jid, x); return [...m.values()]; }";
const newSearch = "function searchList(f: string): ListItem[] { const m = new Map<string, ListItem>(); for (const x of inboxList(f)) m.set(rootJid(x.jid), { ...x, jid: rootJid(x.jid) }); for (const x of contactList(f)) { const jid = rootJid(x.jid); if (!m.has(jid)) m.set(jid, { ...x, jid }); } return [...m.values()]; }";
if (!src.includes('m.set(rootJid(x.jid), { ...x, jid: rootJid(x.jid) })')) {
  if (!src.includes(oldSearch)) {
    console.warn('Search list root dedupe tidak ketemu; lanjut tanpa stop.');
  } else {
    src = src.replace(oldSearch, newSearch);
    changed = true;
  }
}

if (changed) {
  fs.writeFileSync(file, src);
  console.log('patched: chat/contact/message cache is deduped by root JID.');
} else {
  console.log('cache root dedupe already patched.');
}

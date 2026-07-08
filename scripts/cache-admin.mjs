#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DATA = path.join(ROOT, 'data');
const FILES = {
  chats: path.join(DATA, 'chats.json'),
  messages: path.join(DATA, 'messages.json'),
  media: path.join(DATA, 'media.json'),
  aliases: path.join(DATA, 'aliases.json'),
  settings: path.join(DATA, 'settings.json'),
  jidLinks: path.join(DATA, 'jid-links.json'),
};

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
function isJid(s) { return /@(s\.whatsapp\.net|lid|g\.us|newsletter)$/.test(s ?? ''); }
function loadAll() {
  return {
    chats: readJson(FILES.chats, {}),
    messages: readJson(FILES.messages, {}),
    media: readJson(FILES.media, {}),
    aliases: readJson(FILES.aliases, {}),
    settings: readJson(FILES.settings, {}),
    jidLinks: readJson(FILES.jidLinks, {}),
  };
}
function saveAll(state) {
  writeJson(FILES.chats, state.chats);
  writeJson(FILES.messages, state.messages);
  writeJson(FILES.media, state.media);
  writeJson(FILES.aliases, state.aliases);
  writeJson(FILES.settings, state.settings);
  writeJson(FILES.jidLinks, state.jidLinks);
}
function sortedChats(chats) {
  return Object.values(chats).sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0));
}
function resolve(chats, raw) {
  if (!raw) return null;
  const sorted = sortedChats(chats);
  if (/^\d+$/.test(raw)) return sorted[Number(raw) - 1]?.jid ?? null;
  if (isJid(raw)) return raw;
  const q = raw.toLowerCase();
  return Object.keys(chats).find((jid) => chats[jid]?.name?.toLowerCase() === q)
    ?? Object.keys(chats).find((jid) => jid.includes(raw) || chats[jid]?.name?.toLowerCase().includes(q))
    ?? null;
}
function list() {
  const { chats } = loadAll();
  const rows = sortedChats(chats);
  rows.forEach((chat, i) => {
    console.log(`[${i + 1}] ${chat.name}  ${chat.jid}`);
    console.log(`    ${chat.lastMessage ?? ''}`);
  });
}
function merge(fromRaw, toRaw) {
  const state = loadAll();
  const from = resolve(state.chats, fromRaw);
  const to = resolve(state.chats, toRaw);
  if (!from || !to) throw new Error(`Target tidak ketemu. from=${fromRaw} to=${toRaw}`);
  if (from === to) throw new Error('Target sama, tidak perlu merge.');
  state.jidLinks[from] = to;
  const fromChat = state.chats[from];
  const toChat = state.chats[to];
  const newest = !toChat || (fromChat && (fromChat.lastAt ?? 0) > (toChat.lastAt ?? 0)) ? fromChat : toChat;
  state.chats[to] = {
    jid: to,
    name: toChat?.name ?? fromChat?.name ?? to,
    lastMessage: newest?.lastMessage ?? '',
    lastAt: newest?.lastAt ?? Date.now(),
    unread: (toChat?.unread ?? 0) + (fromChat?.unread ?? 0),
  };
  Reflect.deleteProperty(state.chats, from);
  if (state.messages[from]) {
    const moved = state.messages[from].map((m) => ({ ...m, jid: to }));
    state.messages[to] = [...(state.messages[to] ?? []), ...moved].sort((a, b) => (a.at ?? 0) - (b.at ?? 0)).slice(-80);
    Reflect.deleteProperty(state.messages, from);
  }
  for (const item of Object.values(state.media)) if (item.jid === from) item.jid = to;
  for (const [alias, jid] of Object.entries(state.aliases)) if (jid === from) state.aliases[alias] = to;
  if (state.settings.viewOnceForwardJid === from) state.settings.viewOnceForwardJid = to;
  saveAll(state);
  console.log(`Merged: ${fromChat?.name ?? from} -> ${state.chats[to]?.name ?? to}`);
  console.log(`${from} -> ${to}`);
}
function remove(targetRaw) {
  const state = loadAll();
  const target = resolve(state.chats, targetRaw);
  if (!target) throw new Error(`Target tidak ketemu: ${targetRaw}`);
  const name = state.chats[target]?.name ?? target;
  Reflect.deleteProperty(state.chats, target);
  Reflect.deleteProperty(state.messages, target);
  for (const [from, to] of Object.entries(state.jidLinks)) {
    if (from === target || to === target) Reflect.deleteProperty(state.jidLinks, from);
  }
  for (const [alias, jid] of Object.entries(state.aliases)) if (jid === target) Reflect.deleteProperty(state.aliases, alias);
  for (const [id, item] of Object.entries(state.media)) if (item.jid === target) Reflect.deleteProperty(state.media, id);
  if (state.settings.viewOnceForwardJid === target) Reflect.deleteProperty(state.settings, 'viewOnceForwardJid');
  saveAll(state);
  console.log(`Removed local cache: ${name} (${target})`);
}
function usage() {
  console.log(`Usage:
  node scripts/cache-admin.mjs list
  node scripts/cache-admin.mjs merge <from> <to>
  node scripts/cache-admin.mjs remove <target>

Examples:
  node scripts/cache-admin.mjs merge Sin sayang
  node scripts/cache-admin.mjs merge hina bot
  node scripts/cache-admin.mjs remove 120363423633871300@newsletter
`);
}
try {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'list') list();
  else if (cmd === 'merge') merge(args[0], args[1]);
  else if (cmd === 'remove' || cmd === 'delete') remove(args[0]);
  else usage();
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

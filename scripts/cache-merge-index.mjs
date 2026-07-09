#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const DATA = path.join(process.cwd(), 'data');
const FILES = {
  chats: path.join(DATA, 'chats.json'),
  messages: path.join(DATA, 'messages.json'),
  media: path.join(DATA, 'media.json'),
  jidLinks: path.join(DATA, 'jid-links.json'),
  aliases: path.join(DATA, 'aliases.json'),
  localNames: path.join(DATA, 'local-names.json'),
};

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
function short(s, n = 70) {
  return String(s ?? '').length <= n ? String(s ?? '') : `${String(s ?? '').slice(0, n - 1)}…`;
}
function dedupeMessages(list) {
  const clean = [];
  for (const item of list.sort((a, b) => (a.at ?? 0) - (b.at ?? 0))) {
    if (!item?.text || item.text === '[unsupported message]') continue;
    const exists = clean.some((old) => old.jid === item.jid && old.fromMe === item.fromMe && old.text === item.text && Math.abs((old.at ?? 0) - (item.at ?? 0)) <= 3000);
    if (!exists) clean.push(item);
  }
  return clean.slice(-80);
}
function sortedChats(chats) {
  return Object.values(chats)
    .filter((c) => c?.jid && c?.lastMessage && c.lastMessage !== '[unsupported message]')
    .sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0));
}
function nameOf(jid, chats, aliases, localNames) {
  const alias = Object.entries(aliases).find(([, v]) => v === jid)?.[0];
  return localNames[jid] ?? (alias ? `@${alias}` : chats[jid]?.name ?? jid);
}
function resolveIndex(raw, list) {
  const i = Number(raw);
  if (!Number.isInteger(i) || i < 1 || i > list.length) throw new Error(`Index ${raw} tidak ada. Pakai npm run cache:merge-index -- list dulu.`);
  return list[i - 1].jid;
}

const cmd = process.argv[2] ?? 'list';
const chats = readJson(FILES.chats, {});
const messages = readJson(FILES.messages, {});
const media = readJson(FILES.media, {});
const jidLinks = readJson(FILES.jidLinks, {});
const aliases = readJson(FILES.aliases, {});
const localNames = readJson(FILES.localNames, {});
const list = sortedChats(chats);

if (cmd === 'list') {
  if (!list.length) {
    console.log('Inbox cache kosong.');
    process.exit(0);
  }
  list.slice(0, 30).forEach((c, i) => {
    console.log(`[${i + 1}] ${nameOf(c.jid, chats, aliases, localNames)} | ${c.jid}`);
    console.log(`    ${short(c.lastMessage)}`);
  });
  process.exit(0);
}

if (cmd !== 'merge') {
  console.log('Format:');
  console.log('  npm run cache:merge-index -- list');
  console.log('  npm run cache:merge-index -- merge <from-index> <to-index>');
  process.exit(1);
}

const fromRaw = process.argv[3];
const toRaw = process.argv[4];
if (!fromRaw || !toRaw) throw new Error('Format: npm run cache:merge-index -- merge <from-index> <to-index>');

const from = resolveIndex(fromRaw, list);
const to = resolveIndex(toRaw, list);
if (from === to) throw new Error('From dan to sama. Tidak ada yang dimerge.');

const fromChat = chats[from];
const toChat = chats[to];
if (!fromChat || !toChat) throw new Error(`Chat tidak ketemu. from=${from} to=${to}`);

jidLinks[from] = to;

const newest = (fromChat.lastAt ?? 0) > (toChat.lastAt ?? 0) ? fromChat : toChat;
chats[to] = {
  ...toChat,
  name: localNames[to] ?? toChat.name ?? fromChat.name ?? to,
  lastMessage: newest.lastMessage ?? toChat.lastMessage ?? fromChat.lastMessage ?? '',
  lastAt: newest.lastAt ?? Date.now(),
  unread: (toChat.unread ?? 0) + (fromChat.unread ?? 0),
};
delete chats[from];

const moved = (messages[from] ?? []).map((m) => ({ ...m, jid: to }));
messages[to] = dedupeMessages([...(messages[to] ?? []), ...moved]);
delete messages[from];

for (const item of Object.values(media)) {
  if (item?.jid === from) item.jid = to;
}
for (const [alias, jid] of Object.entries(aliases)) {
  if (jid === from) aliases[alias] = to;
}
if (localNames[from] && !localNames[to]) localNames[to] = localNames[from];
delete localNames[from];

writeJson(FILES.jidLinks, jidLinks);
writeJson(FILES.chats, chats);
writeJson(FILES.messages, messages);
writeJson(FILES.media, media);
writeJson(FILES.aliases, aliases);
writeJson(FILES.localNames, localNames);

console.log(`merged [${fromRaw}] ${nameOf(to, chats, aliases, localNames)} <= ${from}`);
console.log(`saved link: ${from} -> ${to}`);

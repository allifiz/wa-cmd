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
  settings: path.join(DATA, 'settings.json'),
};

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
function isLid(jid) { return typeof jid === 'string' && jid.endsWith('@lid'); }
function isPhone(jid) { return typeof jid === 'string' && jid.endsWith('@s.whatsapp.net'); }
function dedupeMessages(list) {
  const clean = [];
  for (const item of list.sort((a, b) => (a.at ?? 0) - (b.at ?? 0))) {
    if (!item?.text || item.text === '[unsupported message]') continue;
    const exists = clean.some((old) => old.jid === item.jid && old.fromMe === item.fromMe && old.text === item.text && Math.abs((old.at ?? 0) - (item.at ?? 0)) <= 3000);
    if (!exists) clean.push(item);
  }
  return clean.slice(-80);
}
function mergeTo(chats, messages, media, aliases, localNames, from, to) {
  const fromChat = chats[from];
  const toChat = chats[to];
  if (fromChat || toChat) {
    const newest = !toChat || (fromChat && (fromChat.lastAt ?? 0) > (toChat.lastAt ?? 0)) ? fromChat : toChat;
    const preferredName = localNames[to] ?? localNames[from] ?? toChat?.name ?? fromChat?.name ?? to;
    chats[to] = {
      ...(toChat ?? {}),
      jid: to,
      name: preferredName,
      lastMessage: newest?.lastMessage ?? toChat?.lastMessage ?? fromChat?.lastMessage ?? '',
      lastAt: newest?.lastAt ?? toChat?.lastAt ?? fromChat?.lastAt ?? Date.now(),
      unread: (toChat?.unread ?? 0) + (fromChat?.unread ?? 0),
    };
    delete chats[from];
  }

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
}

const mode = process.argv[2] ?? 'list';
const chats = readJson(FILES.chats, {});
const messages = readJson(FILES.messages, {});
const media = readJson(FILES.media, {});
const jidLinks = readJson(FILES.jidLinks, {});
const aliases = readJson(FILES.aliases, {});
const localNames = readJson(FILES.localNames, {});
const settings = readJson(FILES.settings, {});

const pairs = Object.entries(jidLinks).filter(([from, to]) => isLid(from) && isPhone(to));

if (mode === 'list') {
  if (!pairs.length) {
    console.log('Tidak ada mapping LID -> phone yang perlu dibalik.');
    process.exit(0);
  }
  pairs.forEach(([lid, phone], i) => {
    const name = localNames[phone] ?? localNames[lid] ?? chats[phone]?.name ?? chats[lid]?.name ?? phone;
    console.log(`[${i + 1}] ${name}`);
    console.log(`    current: ${lid} -> ${phone}`);
    console.log(`    prefer : ${phone} -> ${lid}`);
  });
  process.exit(0);
}

if (mode !== 'apply') {
  console.log('Format:');
  console.log('  npm run cache:prefer-lid -- list');
  console.log('  npm run cache:prefer-lid -- apply');
  process.exit(1);
}

if (!pairs.length) {
  console.log('Tidak ada mapping LID -> phone yang perlu dibalik.');
  process.exit(0);
}

for (const [lid, phone] of pairs) {
  delete jidLinks[lid];
  jidLinks[phone] = lid;
  mergeTo(chats, messages, media, aliases, localNames, phone, lid);
  if (settings.viewOnceForwardJid === phone) settings.viewOnceForwardJid = lid;
  console.log(`prefer LID delivery: ${phone} -> ${lid}`);
}

writeJson(FILES.jidLinks, jidLinks);
writeJson(FILES.chats, chats);
writeJson(FILES.messages, messages);
writeJson(FILES.media, media);
writeJson(FILES.aliases, aliases);
writeJson(FILES.localNames, localNames);
writeJson(FILES.settings, settings);
console.log('done. Jalankan npm run dev lalu coba kirim pesan lagi.');

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), 'src', 'index.ts');
let src = fs.readFileSync(file, 'utf8');
let changed = false;

const helper = "function resolveLinkEndpoint(raw: string, side: 'from' | 'to'): string { const v = raw.trim(); if (!v) throw new Error('Target link kosong.'); if (v === '.' || v === 'this') { if (!currentChat) throw new Error('Tidak sedang di room chat.'); return currentChat; } if (side === 'to' && /^62\\d{8,14}$/.test(v)) return `${v}@s.whatsapp.net`; if (side === 'from' && mode !== 'chat') { const byIndex = resolveIndex(v); if (byIndex) return rootJid(byIndex); } return resolveTarget(v); }";
const forceFn = "function forceLinkJids(fromRaw: string, toRaw: string): string { const from = jidNormalizedUser(fromRaw) ?? fromRaw; const to = jidNormalizedUser(toRaw) ?? toRaw; if (!from || !to || from === to) return to || from || fromRaw; for (const [a, b] of [...jidLinks.entries()]) if (a === from || b === from || a === to || b === to) jidLinks.delete(a); jidLinks.set(from, to); const fromChat = chats.get(from); const toChat = chats.get(to); if (fromChat || toChat) { const newest = !toChat || (fromChat && fromChat.lastAt > toChat.lastAt) ? fromChat : toChat; const preferredName = contactName(to) ?? aliasOf(to)?.replace(/^/, '@') ?? toChat?.name ?? fromChat?.name ?? to; chats.set(to, { jid: to, name: preferredName, lastMessage: newest?.lastMessage ?? '', lastAt: newest?.lastAt ?? Date.now(), unread: (toChat?.unread ?? 0) + (fromChat?.unread ?? 0) }); chats.delete(from); } const fromMsgs = messages.get(from) ?? []; if (fromMsgs.length) { messages.set(to, dedupeMessageList([...(messages.get(to) ?? []), ...fromMsgs.map((m) => ({ ...m, jid: to }))])); messages.delete(from); } for (const item of media.values()) if (item.jid === from) item.jid = to; for (const [alias, jid] of Object.entries(aliases)) if (jid === from) aliases[alias] = to; for (const [jid, name] of Object.entries(localNames)) if (jid === from) { localNames[to] = localNames[to] ?? name; delete localNames[jid]; } if (settings.viewOnceForwardJid === from) settings.viewOnceForwardJid = to; if (currentChat === from) currentChat = to; return to; }";

if (!src.includes("function resolveLinkEndpoint(raw: string, side: 'from' | 'to')")) {
  const marker = 'function linkJids(';
  const pos = src.indexOf(marker);
  if (pos === -1) {
    console.error('Target patch tidak ketemu: insert resolveLinkEndpoint');
    process.exit(1);
  }
  src = `${src.slice(0, pos)}${helper}\n${src.slice(pos)}`;
  changed = true;
}

if (!src.includes('function forceLinkJids(')) {
  const marker = 'function linkJids(';
  const pos = src.indexOf(marker);
  if (pos === -1) {
    console.error('Target patch tidak ketemu: insert forceLinkJids');
    process.exit(1);
  }
  src = `${src.slice(0, pos)}${forceFn}\n${src.slice(pos)}`;
  changed = true;
}

const oldFn = "function linkJids(fromRaw: string, toRaw: string): void { const from = resolveTarget(fromRaw); const to = resolveTarget(toRaw); if (!isLidJid(from) && !isLidJid(rootJid(from))) throw new Error('Sumber link harus @lid / room LID. Contoh: /link 1 2'); const canonical = mergeJidData(from, to); saveData(); console.log(chalk.green(`Linked ${from} -> ${nameOf(canonical)} (${canonical})`)); render(); }";
const newerFn = "function linkJids(fromRaw: string, toRaw: string): void { const from = resolveLinkEndpoint(fromRaw, 'from'); const to = resolveLinkEndpoint(toRaw, 'to'); if (!isLidJid(from) && !isLidJid(rootJid(from))) throw new Error('Sumber link harus @lid / room LID. Contoh: /link 1 628xxx atau /link . 628xxx'); const canonical = mergeJidData(from, to); saveData(); render(); console.log(chalk.green(`Linked ${from} -> ${nameOf(canonical)} (${canonical})`)); }";
const forcedFn = "function linkJids(fromRaw: string, toRaw: string): void { const from = resolveLinkEndpoint(fromRaw, 'from'); const to = resolveLinkEndpoint(toRaw, 'to'); if (!isLidJid(from) && !isLidJid(rootJid(from))) throw new Error('Sumber link harus @lid / room LID. Contoh: /link 1 628xxx atau /link . 628xxx'); const canonical = /^62\\d{8,14}@s\\.whatsapp\\.net$/.test(to) ? forceLinkJids(from, to) : mergeJidData(from, to); saveData(); render(); console.log(chalk.green(`Linked ${from} -> ${nameOf(canonical)} (${canonical})`)); }";

if (!src.includes('forceLinkJids(from, to)')) {
  if (src.includes(newerFn)) {
    src = src.replace(newerFn, forcedFn);
    changed = true;
  } else if (src.includes(oldFn)) {
    src = src.replace(oldFn, forcedFn);
    changed = true;
  } else {
    console.error('Target patch tidak ketemu: replace linkJids');
    process.exit(1);
  }
}

if (changed) {
  fs.writeFileSync(file, src);
  console.log('patched: /link forces explicit 628 phone target and clears stale reverse links.');
} else {
  console.log('link command already patched.');
}

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

patch(
  'settings selfJids type',
  'type SettingsStore = { viewOnceForwardJid?: string; messageCensorEnabled?: boolean };',
  'type SettingsStore = { viewOnceForwardJid?: string; messageCensorEnabled?: boolean; selfJids?: string[] };'
);

const helpers = "function configuredSelfJids(): string[] { return [...new Set((settings.selfJids ?? []).map((jid) => rootJid(jid)).filter(Boolean))]; }\nfunction isSelfJid(jidRaw: string): boolean { const jid = rootJid(jidRaw); return configuredSelfJids().includes(jid); }\nfunction forgetSelfChat(jidRaw: string): void { const jid = rootJid(jidRaw); chats.delete(jid); messages.delete(jid); contacts.delete(jid); for (const [id, item] of [...media.entries()]) if (rootJid(item.jid) === jid) media.delete(id); for (const [alias, aliasJid] of Object.entries(aliases)) if (rootJid(aliasJid) === jid) delete aliases[alias]; delete localNames[jid]; if (settings.viewOnceForwardJid && rootJid(settings.viewOnceForwardJid) === jid) delete settings.viewOnceForwardJid; if (currentChat && rootJid(currentChat) === jid) { currentChat = null; mode = 'inbox'; pendingQuote = null; } }\nfunction markSelfChat(targetRaw: string): void { const jid = rootJid(resolveTarget(targetRaw)); settings.selfJids = [...new Set([...configuredSelfJids(), jid])]; forgetSelfChat(jid); saveData(); render(); console.log(chalk.yellow(`Self chat disembunyikan: ${jid}`)); }\nfunction unmarkSelfChat(targetRaw: string): void { const jid = rootJid(resolveTarget(targetRaw)); settings.selfJids = configuredSelfJids().filter((x) => x !== jid); saveData(); render(); console.log(chalk.yellow(`Self chat dilepas dari filter: ${jid}`)); }";

if (!src.includes('function configuredSelfJids()')) {
  const marker = 'function sortedChats(): ChatItem[]';
  const pos = src.indexOf(marker);
  if (pos === -1) {
    console.error('Target patch tidak ketemu: insert self chat helpers');
    process.exit(1);
  }
  src = `${src.slice(0, pos)}${helpers}\n${src.slice(pos)}`;
  changed = true;
}

if (src.includes('function sortedChats(): ChatItem[] { return [...chats.values()].filter((c) => c.lastMessage')) {
  src = src.replace(
    "function sortedChats(): ChatItem[] { return [...chats.values()].filter((c) => c.lastMessage && c.lastMessage !== '[unsupported message]').sort((a, b) => b.lastAt - a.lastAt); }",
    "function sortedChats(): ChatItem[] { return [...chats.values()].filter((c) => !isSelfJid(c.jid) && c.lastMessage && c.lastMessage !== '[unsupported message]').sort((a, b) => b.lastAt - a.lastAt); }"
  );
  changed = true;
} else if (src.includes('if (!raw.lastMessage || raw.lastMessage === \'[unsupported message]\') continue;') && !src.includes('if (isSelfJid(raw.jid)) continue;')) {
  src = src.replace(
    "if (!raw.lastMessage || raw.lastMessage === '[unsupported message]') continue;",
    "if (isSelfJid(raw.jid)) continue; if (!raw.lastMessage || raw.lastMessage === '[unsupported message]') continue;"
  );
  changed = true;
}

if (src.includes('function mergedContacts(): ContactItem[] { const m = new Map<string, ContactItem>(contacts);')) {
  src = src.replace(
    "function mergedContacts(): ContactItem[] { const m = new Map<string, ContactItem>(contacts); for (const ch of chats.values()) if (!m.has(ch.jid)) m.set(ch.jid, { jid: ch.jid, name: ch.name, updatedAt: ch.lastAt }); return [...m.values()]; }",
    "function mergedContacts(): ContactItem[] { const m = new Map<string, ContactItem>(); for (const [jid, c] of contacts.entries()) if (!isSelfJid(jid)) m.set(jid, c); for (const ch of chats.values()) if (!isSelfJid(ch.jid) && !m.has(ch.jid)) m.set(ch.jid, { jid: ch.jid, name: ch.name, updatedAt: ch.lastAt }); return [...m.values()]; }"
  );
  changed = true;
} else if (src.includes('for (const [jid, c] of contacts.entries())') && !src.includes('if (!isSelfJid(jid)) m.set')) {
  src = src.replace('for (const [jid, c] of contacts.entries()) m.set', 'for (const [jid, c] of contacts.entries()) if (!isSelfJid(jid)) m.set');
  changed = true;
}

if (!src.includes("cmd === '/self'")) {
  const old = "return linkJids(from, to); } if (cmd === '/close' || cmd === '/back')";
  const to = "return linkJids(from, to); } if (cmd === '/self') { const target = args.join(' ') || '.'; return markSelfChat(target); } if (cmd === '/unself') { const target = args.join(' ') || '.'; return unmarkSelfChat(target); } if (cmd === '/close' || cmd === '/back')";
  patch('self slash command', old, to);
}

if (!src.includes('if (isSelfJid(jid)) { forgetSelfChat(jid);')) {
  const old = "const jid = fromMe ? rootJid(rawJid) : findLikelyCanonicalForIncoming(rawJid, m.pushName, m as any); if (!isOneToOneJid(jid) && jid.includes('@newsletter')) continue;";
  const to = "const jid = fromMe ? rootJid(rawJid) : findLikelyCanonicalForIncoming(rawJid, m.pushName, m as any); if (isSelfJid(jid)) { forgetSelfChat(jid); changed = true; continue; } if (!isOneToOneJid(jid) && jid.includes('@newsletter')) continue;";
  patch('drop configured self incoming chat', old, to);
}

if (src.includes('/link <lid-target> <real-target> | /merge <lid-target> <real-target>\n  /send <target> <pesan>') && !src.includes('/self <target>')) {
  src = src.replace(
    '/link <lid-target> <real-target> | /merge <lid-target> <real-target>\n  /send <target> <pesan>',
    '/link <lid-target> <real-target> | /merge <lid-target> <real-target>\n  /self <target> | /unself <target>\n  /send <target> <pesan>'
  );
  changed = true;
}

if (changed) {
  fs.writeFileSync(file, src);
  console.log('patched: self chats can be hidden with /self <target>.');
} else {
  console.log('self chat filter already patched.');
}

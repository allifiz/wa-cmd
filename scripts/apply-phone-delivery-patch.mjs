#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), 'src', 'index.ts');
let src = fs.readFileSync(file, 'utf8');
let changed = false;

const helper = "function deliveryJid(jidRaw: string): string { const jid = rootJid(jidRaw); if (!isLidJid(jid)) return jid; const linkedPhone = [...jidLinks.keys()].find((from) => isPhoneJid(from) && rootJid(from) === jid); if (linkedPhone) return linkedPhone; const local = norm(localNameOf(jid) ?? nameOf(jid)); if (local) { const matches = [...contacts.keys(), ...chats.keys()].filter((x) => isPhoneJid(x)).filter((phone) => { const names = searchableNames(phone).map(norm); return names.includes(local); }); if (matches.length === 1) return matches[0]; } return jid; }";

if (!src.includes('function deliveryJid(jidRaw: string): string')) {
  const marker = 'async function sendText(';
  const pos = src.indexOf(marker);
  if (pos === -1) {
    console.error('Target patch tidak ketemu: insert deliveryJid helper');
    process.exit(1);
  }
  src = `${src.slice(0, pos)}${helper}\n${src.slice(pos)}`;
  changed = true;
}

const oldSendText = "async function sendText(sock: ReturnType<typeof makeWASocket>, jidRaw: string, text: string): Promise<void> { const jid = rootJid(jidRaw); const sent = await sock.sendMessage(jid, { text } as AnyMessageContent);";
const newSendText = "async function sendText(sock: ReturnType<typeof makeWASocket>, jidRaw: string, text: string): Promise<void> { const jid = rootJid(jidRaw); const target = deliveryJid(jid); const sent = await sock.sendMessage(target, { text } as AnyMessageContent);";
if (!src.includes('const target = deliveryJid(jid); const sent = await sock.sendMessage(target, { text } as AnyMessageContent);')) {
  if (!src.includes(oldSendText)) {
    console.error('Target patch tidak ketemu: sendText delivery target');
    process.exit(1);
  }
  src = src.replace(oldSendText, newSendText);
  changed = true;
}

const oldQuoted = "async function sendQuotedText(sock: ReturnType<typeof makeWASocket>, jidRaw: string, quoted: StoredMessage, text: string): Promise<void> { const jid = rootJid(jidRaw); const clean = text.trim(); if (!clean) throw new Error('Pesan kosong. Format: q <no> <pesan>'); const sent = await sock.sendMessage(jid, { text: clean }, { quoted: quoted.quote } as any);";
const newQuoted = "async function sendQuotedText(sock: ReturnType<typeof makeWASocket>, jidRaw: string, quoted: StoredMessage, text: string): Promise<void> { const jid = rootJid(jidRaw); const target = deliveryJid(jid); const clean = text.trim(); if (!clean) throw new Error('Pesan kosong. Format: q <no> <pesan>'); const sent = await sock.sendMessage(target, { text: clean }, { quoted: quoted.quote } as any);";
if (!src.includes('const target = deliveryJid(jid); const clean = text.trim();')) {
  if (!src.includes(oldQuoted)) {
    console.warn('sendQuotedText delivery target tidak ketemu; lanjut tanpa stop.');
  } else {
    src = src.replace(oldQuoted, newQuoted);
    changed = true;
  }
}

if (changed) {
  fs.writeFileSync(file, src);
  console.log('patched: linked LID chats send through phone JID when available.');
} else {
  console.log('phone delivery already patched.');
}

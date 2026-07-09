#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), 'src', 'index.ts');
let src = fs.readFileSync(file, 'utf8');
let changed = false;

const helper = "function decodeDisplayName(value?: string | null): string | undefined { const raw = value?.trim(); if (!raw) return undefined; const mimeQ = raw.match(/^=\\?([^?]+)\\?Q\\?(.+)\\?=$/i); const mimeB = raw.match(/^=\\?([^?]+)\\?B\\?(.+)\\?=$/i); try { if (mimeB) return Buffer.from(mimeB[2], 'base64').toString('utf8').trim() || raw; const input = mimeQ ? mimeQ[2].replace(/_/g, ' ') : raw; if (!/=([0-9A-Fa-f]{2})/.test(input)) return raw; const binary = input.replace(/=([0-9A-Fa-f]{2})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16))); return Buffer.from(binary, 'latin1').toString('utf8').trim() || raw; } catch { return raw; } }";

if (!src.includes('function decodeDisplayName(')) {
  const marker = 'function safeFilePart';
  const pos = src.indexOf(marker);
  if (pos === -1) {
    console.error('Target patch tidak ketemu: insert decodeDisplayName helper');
    process.exit(1);
  }
  src = `${src.slice(0, pos)}${helper}\n${src.slice(pos)}`;
  changed = true;
}

const oldUpsert = "function upsertContact(jid: string, name?: string | null, notify?: string | null, verifiedName?: string | null): void { const id = rootJid(jidNormalizedUser(jid) ?? jid); if (!id || id === 'status@broadcast') return; const old = contacts.get(id); contacts.set(id, { jid: id, name: name || notify || verifiedName || old?.name || id, notify: notify ?? old?.notify, verifiedName: verifiedName ?? old?.verifiedName, updatedAt: Date.now() }); }";
const newUpsert = "function upsertContact(jid: string, name?: string | null, notify?: string | null, verifiedName?: string | null): void { const id = rootJid(jidNormalizedUser(jid) ?? jid); if (!id || id === 'status@broadcast') return; const old = contacts.get(id); const cleanName = decodeDisplayName(name) ?? decodeDisplayName(notify) ?? decodeDisplayName(verifiedName) ?? decodeDisplayName(old?.name) ?? id; contacts.set(id, { jid: id, name: cleanName, notify: decodeDisplayName(notify) ?? old?.notify, verifiedName: decodeDisplayName(verifiedName) ?? old?.verifiedName, updatedAt: Date.now() }); }";
if (!src.includes('const cleanName = decodeDisplayName(name)')) {
  if (!src.includes(oldUpsert)) {
    console.error('Target patch tidak ketemu: decode upsertContact names');
    process.exit(1);
  }
  src = src.replace(oldUpsert, newUpsert);
  changed = true;
}

const oldContactName = "function contactName(jidRaw: string): string | null { const jid = rootJid(jidRaw); const c = contacts.get(jid) ?? contacts.get(jidRaw); return localNameOf(jid) ?? c?.name ?? c?.notify ?? c?.verifiedName ?? null; }";
const newContactName = "function contactName(jidRaw: string): string | null { const jid = rootJid(jidRaw); const c = contacts.get(jid) ?? contacts.get(jidRaw); return localNameOf(jid) ?? decodeDisplayName(c?.name) ?? decodeDisplayName(c?.notify) ?? decodeDisplayName(c?.verifiedName) ?? null; }";
if (!src.includes('decodeDisplayName(c?.name)')) {
  if (!src.includes(oldContactName)) {
    console.warn('contactName decode target tidak ketemu; lanjut tanpa stop.');
  } else {
    src = src.replace(oldContactName, newContactName);
    changed = true;
  }
}

const oldSearchable = "function searchableNames(jid: string): string[] { const c = contacts.get(jid); const ch = chats.get(jid); return [localNameOf(jid), c?.name, c?.notify, c?.verifiedName, ch?.name, aliasOf(jid)].filter(Boolean) as string[]; }";
const newSearchable = "function searchableNames(jid: string): string[] { const c = contacts.get(jid); const ch = chats.get(jid); return [localNameOf(jid), decodeDisplayName(c?.name), decodeDisplayName(c?.notify), decodeDisplayName(c?.verifiedName), decodeDisplayName(ch?.name), aliasOf(jid)].filter(Boolean) as string[]; }";
if (!src.includes('decodeDisplayName(ch?.name)')) {
  if (!src.includes(oldSearchable)) {
    console.warn('searchableNames decode target tidak ketemu; lanjut tanpa stop.');
  } else {
    src = src.replace(oldSearchable, newSearchable);
    changed = true;
  }
}

const oldMerged = "function mergedContacts(): ContactItem[] { const m = new Map<string, ContactItem>(contacts); for (const ch of chats.values()) if (!m.has(ch.jid)) m.set(ch.jid, { jid: ch.jid, name: ch.name, updatedAt: ch.lastAt }); return [...m.values()]; }";
const newMerged = "function mergedContacts(): ContactItem[] { const m = new Map<string, ContactItem>(); for (const [jid, c] of contacts.entries()) m.set(jid, { ...c, name: decodeDisplayName(c.name) ?? c.name, notify: decodeDisplayName(c.notify) ?? c.notify, verifiedName: decodeDisplayName(c.verifiedName) ?? c.verifiedName }); for (const ch of chats.values()) if (!m.has(ch.jid)) m.set(ch.jid, { jid: ch.jid, name: decodeDisplayName(ch.name) ?? ch.name, updatedAt: ch.lastAt }); return [...m.values()]; }";
if (!src.includes('for (const [jid, c] of contacts.entries()) m.set(jid, { ...c, name: decodeDisplayName(c.name)')) {
  if (!src.includes(oldMerged)) {
    console.warn('mergedContacts decode target tidak ketemu; lanjut tanpa stop.');
  } else {
    src = src.replace(oldMerged, newMerged);
    changed = true;
  }
}

if (changed) {
  fs.writeFileSync(file, src);
  console.log('patched: quoted-printable contact names are decoded.');
} else {
  console.log('contact name decoder already patched.');
}

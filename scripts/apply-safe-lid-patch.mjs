#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), 'src', 'index.ts');
let src = fs.readFileSync(file, 'utf8');
let changed = false;

function patch(label, fn) {
  const before = src;
  src = fn(src);
  if (src !== before) {
    changed = true;
    console.log(`[patch] ${label}`);
  }
}

const safeResolver = `function sameBareNumber(a: string, b: string): boolean {
  const ax = a.replace(/\\D/g, '');
  const bx = b.replace(/\\D/g, '');
  return Boolean(ax && bx && (ax === bx || ax.endsWith(bx) || bx.endsWith(ax)));
}

function pushNameMatchesJid(jid: string, pushName?: string): boolean {
  const push = norm(pushName ?? '');
  if (!push) return false;
  return searchableNames(jid).some((name) => norm(name) === push);
}

function phoneJidFromValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/\d{7,20}@s\.whatsapp\.net/);
  if (!match) return null;
  const normalized = jidNormalizedUser(match[0]) ?? match[0];
  return isPhoneJid(normalized) ? normalized : null;
}

function uniquePhoneJids(values: unknown[]): string[] {
  return values
    .map(phoneJidFromValue)
    .filter(Boolean)
    .map((jid) => rootJid(jid as string))
    .filter((jid, i, arr) => isPhoneJid(jid) && arr.indexOf(jid) === i);
}

function findPayloadPhoneJid(rawMessage?: unknown): string | null {
  const raw = rawMessage as any;
  const key = raw?.key ?? {};

  // Penting: jangan scan seluruh payload. Context/quoted message bisa berisi nomor chat lain.
  // Ambil hanya field identitas sender/participant yang biasa dipakai Baileys.
  const directCandidates = uniquePhoneJids([
    key.senderPn,
    key.participantPn,
    key.participant,
    key.remoteJidAlt,
    key.remoteJidPn,
    raw?.senderPn,
    raw?.participantPn,
    raw?.participant,
  ]);
  if (directCandidates.length === 1) return directCandidates[0];

  const known = directCandidates.filter((jid) => contacts.has(jid) || chats.has(jid));
  return known.length === 1 ? known[0] : null;
}

function findManualLinkedJid(rawJid: string, pushName?: string): string | null {
  const id = jidNormalizedUser(rawJid) ?? rawJid;
  const direct = jidLinks.get(id);
  if (direct) {
    const target = rootJid(direct);
    if (!isLidJid(id)) return target;
    if (pushNameMatchesJid(target, pushName) || sameBareNumber(id, target)) return target;
    jidLinks.delete(id);
  }

  const push = norm(pushName ?? '');
  if (!push) return null;

  const candidates = [...chats.keys(), ...contacts.keys()]
    .map((jid) => rootJid(jid))
    .filter((jid, i, arr) => arr.indexOf(jid) === i && jid !== id && isPhoneJid(jid));

  const exactMatches = candidates.filter((jid) => searchableNames(jid).some((name) => norm(name) === push));
  return exactMatches.length === 1 ? mergeJidData(id, exactMatches[0]) : null;
}

function findLikelyCanonicalForIncoming(rawJid: string, pushName: string | undefined, at: number, rawMessage?: unknown): string {
  const id = jidNormalizedUser(rawJid) ?? rawJid;
  if (!isLidJid(id)) return rootJid(id);

  const payloadPhone = findPayloadPhoneJid(rawMessage);
  if (payloadPhone) return mergeJidData(id, payloadPhone);

  const manual = findManualLinkedJid(id, pushName);
  if (manual) return manual;

  return id;
}

function repairJidLinksFromHistory(): void {
  for (const [from, to] of [...jidLinks.entries()]) {
    if (!isLidJid(from)) continue;
    const target = rootJid(to);
    if (!isPhoneJid(target) || !contacts.has(target)) jidLinks.delete(from);
  }
}`;

patch('safe lid resolver', (s) => {
  const start = s.includes('function sameBareNumber')
    ? s.indexOf('function sameBareNumber')
    : s.indexOf('function findLikelyCanonicalForIncoming');
  const end = s.indexOf('\nfunction unwrapMessage', start);
  if (start === -1 || end === -1) return s;
  return `${s.slice(0, start)}${safeResolver}${s.slice(end)}`;
});

patch('pass raw message to lid resolver', (s) => {
  return s.replaceAll(
    'findLikelyCanonicalForIncoming(rawJid, m.pushName ?? undefined, at)',
    'findLikelyCanonicalForIncoming(rawJid, m.pushName ?? undefined, at, m as any)'
  ).replaceAll(
    'findLikelyCanonicalForIncoming(rawJid, m.pushName, at)',
    'findLikelyCanonicalForIncoming(rawJid, m.pushName ?? undefined, at, m as any)'
  );
});

if (changed) fs.writeFileSync(file, src);

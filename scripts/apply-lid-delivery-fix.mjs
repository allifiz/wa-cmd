#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), 'src', 'index.ts');
let src = fs.readFileSync(file, 'utf8');
let changed = false;

function patch(label, from, to, marker) {
  if (src.includes(to) || (marker && src.includes(marker))) return;
  if (!src.includes(from)) {
    console.error(`Target patch tidak ketemu: ${label}`);
    process.exit(1);
  }
  src = src.replace(from, to);
  changed = true;
}

function patchOptional(label, from, to, marker) {
  if (src.includes(to) || (marker && src.includes(marker))) return true;
  if (!src.includes(from)) return false;
  src = src.replace(from, to);
  changed = true;
  return true;
}

patch(
  'mergeJidData contact copy',
  "function mergeJidData(fromRaw: string, toRaw: string): string { const from = jidNormalizedUser(fromRaw); const to = jidNormalizedUser(toRaw); if (!from || !to || from === to) return to ?? from ?? fromRaw; const canonical = rootJid(to); if (from === canonical) return canonical; jidLinks.set(from, canonical); const fromChat = chats.get(from); const toChat = chats.get(canonical); if (fromChat || toChat) { const newest = !toChat || (fromChat && fromChat.lastAt > toChat.lastAt) ? fromChat : toChat; const preferredName = contactName(canonical) ?? aliasOf(canonical)?.replace(/^/, '@') ?? toChat?.name ?? fromChat?.name ?? canonical; chats.set(canonical, { jid: canonical, name: preferredName, lastMessage: newest?.lastMessage ?? '', lastAt: newest?.lastAt ?? Date.now(), unread: (toChat?.unread ?? 0) + (fromChat?.unread ?? 0) }); chats.delete(from); } const fromMsgs = messages.get(from) ?? []; if (fromMsgs.length) { messages.set(canonical, dedupeMessageList([...(messages.get(canonical) ?? []), ...fromMsgs.map((m) => ({ ...m, jid: canonical }))])); messages.delete(from); } for (const item of media.values()) if (item.jid === from) item.jid = canonical; for (const [alias, jid] of Object.entries(aliases)) if (jid === from) aliases[alias] = canonical; for (const [jid, name] of Object.entries(localNames)) if (jid === from) { localNames[canonical] = localNames[canonical] ?? name; delete localNames[jid]; } if (settings.viewOnceForwardJid === from) settings.viewOnceForwardJid = canonical; if (currentChat === from) currentChat = canonical; return canonical; }",
  "function mergeJidData(fromRaw: string, toRaw: string): string { const from = jidNormalizedUser(fromRaw); const to = jidNormalizedUser(toRaw); if (!from || !to || from === to) return to ?? from ?? fromRaw; const canonical = rootJid(to); if (from === canonical) return canonical; jidLinks.set(from, canonical); const fromContact = contacts.get(from); const toContact = contacts.get(canonical); const movedLocalName = localNames[canonical] ?? localNames[from]; const contactPreferredName = movedLocalName ?? toContact?.name ?? fromContact?.name ?? toContact?.notify ?? fromContact?.notify ?? toContact?.verifiedName ?? fromContact?.verifiedName; if (fromContact || toContact) { contacts.set(canonical, { jid: canonical, name: contactPreferredName ?? canonical, notify: toContact?.notify ?? fromContact?.notify, verifiedName: toContact?.verifiedName ?? fromContact?.verifiedName, updatedAt: Date.now() }); contacts.delete(from); } const fromChat = chats.get(from); const toChat = chats.get(canonical); if (fromChat || toChat) { const newest = !toChat || (fromChat && fromChat.lastAt > toChat.lastAt) ? fromChat : toChat; const preferredName = contactPreferredName ?? contactName(canonical) ?? aliasOf(canonical)?.replace(/^/, '@') ?? toChat?.name ?? fromChat?.name ?? canonical; chats.set(canonical, { jid: canonical, name: preferredName, lastMessage: newest?.lastMessage ?? '', lastAt: newest?.lastAt ?? Date.now(), unread: (toChat?.unread ?? 0) + (fromChat?.unread ?? 0) }); chats.delete(from); } const fromMsgs = messages.get(from) ?? []; if (fromMsgs.length) { messages.set(canonical, dedupeMessageList([...(messages.get(canonical) ?? []), ...fromMsgs.map((m) => ({ ...m, jid: canonical }))])); messages.delete(from); } for (const item of media.values()) if (item.jid === from) item.jid = canonical; for (const [alias, jid] of Object.entries(aliases)) if (jid === from) aliases[alias] = canonical; for (const [jid, name] of Object.entries(localNames)) if (jid === from) { localNames[canonical] = localNames[canonical] ?? name; delete localNames[jid]; } if (settings.viewOnceForwardJid === from) settings.viewOnceForwardJid = canonical; if (currentChat === from) currentChat = canonical; return canonical; }",
  'const fromContact = contacts.get(from); const toContact = contacts.get(canonical);'
);

patch(
  'deep phone candidate scan helper',
  "function uniquePhoneJids(values: unknown[]): string[] { return [...new Set(values.map(phoneJidFromValue).filter(Boolean) as string[])]; }",
  "function uniquePhoneJids(values: unknown[]): string[] { return [...new Set(values.map(phoneJidFromValue).filter(Boolean) as string[])]; }\nfunction collectPhoneJidsFromPayload(value: unknown, depth = 0, seen = new WeakSet<object>()): string[] { if (!value || depth > 8) return []; if (typeof value === 'string') { const phone = phoneJidFromValue(value); return phone ? [phone] : []; } if (typeof value !== 'object') return []; if (seen.has(value)) return []; seen.add(value); const found: string[] = []; for (const child of Object.values(value as Record<string, unknown>)) found.push(...collectPhoneJidsFromPayload(child, depth + 1, seen)); return [...new Set(found)]; }",
  'function collectPhoneJidsFromPayload('
);

patch(
  'payload phone deep scan',
  "function findPayloadPhoneJid(raw: any): string | null { const key = raw?.key ?? {}; const directCandidates = uniquePhoneJids([key.senderPn, key.participantPn, key.participant, key.remoteJidAlt, key.remoteJidPn, raw?.senderPn, raw?.participantPn, raw?.participant]); return directCandidates.length === 1 ? directCandidates[0] : null; }",
  "function findPayloadPhoneJid(raw: any): string | null { const key = raw?.key ?? {}; const directCandidates = uniquePhoneJids([key.senderPn, key.participantPn, key.participant, key.remoteJidAlt, key.remoteJidPn, raw?.senderPn, raw?.participantPn, raw?.participant]); if (directCandidates.length === 1) return directCandidates[0]; const deepCandidates = collectPhoneJidsFromPayload(raw); return deepCandidates.length === 1 ? deepCandidates[0] : null; }",
  'const deepCandidates = collectPhoneJidsFromPayload(raw);'
);

patch(
  'prefer lid delivery canonical',
  "function findLikelyCanonicalForIncoming(rawJid: string, pushName: string | undefined, raw?: any): string { const id = jidNormalizedUser(rawJid); if (!id) return rawJid; if (!isLidJid(id)) return rootJid(id); const payloadPhone = findPayloadPhoneJid(raw); if (payloadPhone) return mergeJidData(id, payloadPhone); const manual = findManualLinkedJid(id, pushName); if (manual) return manual; const push = norm(pushName ?? ''); if (push) { const matches = [...chats.keys(), ...contacts.keys()].map((jid) => rootJid(jid)).filter((jid, i, arr) => arr.indexOf(jid) === i && jid !== id && isPhoneJid(jid)).filter((jid) => searchableNames(jid).some((name) => norm(name) === push)); if (matches.length === 1) return mergeJidData(id, matches[0]); } return id; }",
  "function findLikelyCanonicalForIncoming(rawJid: string, pushName: string | undefined, raw?: any): string { const id = jidNormalizedUser(rawJid); if (!id) return rawJid; if (!isLidJid(id)) return rootJid(id); const payloadPhone = findPayloadPhoneJid(raw); if (payloadPhone) return mergeJidData(payloadPhone, id); const manual = findManualLinkedJid(id, pushName); if (manual) return manual; const push = norm(pushName ?? ''); if (push) { const matches = [...chats.keys(), ...contacts.keys()].map((jid) => rootJid(jid)).filter((jid, i, arr) => arr.indexOf(jid) === i && jid !== id && isPhoneJid(jid)).filter((jid) => searchableNames(jid).some((name) => norm(name) === push)); if (matches.length === 1) return mergeJidData(matches[0], id); } return id; }",
  'if (payloadPhone) return mergeJidData(payloadPhone, id);'
);

if (!src.includes('jidLinks.set(target, from); continue;')) {
  const oldRepair = "function repairJidLinksFromHistory(): void { for (const [from, to] of [...jidLinks.entries()]) { if (!isLidJid(from)) continue; const target = rootJid(to); if (!isPhoneJid(target) && !target.endsWith('@g.us')) jidLinks.delete(from); } }";
  const newRepair = "function repairJidLinksFromHistory(): void { for (const [from, to] of [...jidLinks.entries()]) { const target = rootJid(to); if (isLidJid(from) && isPhoneJid(target)) { jidLinks.delete(from); jidLinks.set(target, from); continue; } if (isLidJid(from) && !isPhoneJid(target) && !target.endsWith('@g.us')) jidLinks.delete(from); } }";
  if (src.includes(oldRepair)) {
    src = src.replace(oldRepair, newRepair);
    changed = true;
  } else {
    console.warn('repair old lid-phone links target tidak ketemu; lanjut karena safety patch akan repair nanti.');
  }
}

patch(
  'nullable Baileys pushName',
  "findLikelyCanonicalForIncoming(rawJid, m.pushName, m as any)",
  "findLikelyCanonicalForIncoming(rawJid, m.pushName ?? undefined, m as any)",
  'findLikelyCanonicalForIncoming(rawJid, m.pushName ?? undefined, m as any)'
);

if (changed) {
  fs.writeFileSync(file, src);
  console.log('patched: LID jadi canonical delivery; nomor dari VCF dipakai buat copy nama kontak.');
} else {
  console.log('lid delivery source already patched.');
}

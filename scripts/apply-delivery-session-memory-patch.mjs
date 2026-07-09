#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), 'src', 'index.ts');
let src = fs.readFileSync(file, 'utf8');
let changed = false;

const deliveryBlock = "function rememberedDeliveryJid(jidRaw: string): string | null { const jid = rootJid(jidRaw); const map = ((settings as any).deliveryJids ?? {}) as Record<string, string>; const saved = jidNormalizedUser(map[jid] ?? ''); if (!saved || saved === jid) return null; return saved; }\nfunction rememberDeliveryJid(canonicalRaw: string, deliveryRaw: string): void { const canonical = rootJid(canonicalRaw); const delivery = jidNormalizedUser(deliveryRaw); if (!delivery || canonical === delivery) return; if (!isOneToOneJid(canonical) || !isOneToOneJid(delivery)) return; const map = (((settings as any).deliveryJids ??= {}) as Record<string, string>); map[canonical] = delivery; }\nfunction deliveryJid(jidRaw: string): string { const jid = rootJid(jidRaw); const remembered = rememberedDeliveryJid(jid); if (remembered) return remembered; if (!isLidJid(jid)) return jid; const linkedPhone = [...jidLinks.keys()].find((from) => isPhoneJid(from) && rootJid(from) === jid); if (linkedPhone) return linkedPhone; const local = norm(localNameOf(jid) ?? nameOf(jid)); if (local) { const matches = [...contacts.keys(), ...chats.keys()].filter((x) => isPhoneJid(x)).filter((phone) => { const names = searchableNames(phone).map(norm); return names.includes(local); }); if (matches.length === 1) return matches[0]; } return jid; }";

if (src.includes('function deliveryJid(jidRaw: string): string')) {
  if (!src.includes('function rememberedDeliveryJid(')) {
    const start = src.indexOf('function deliveryJid(jidRaw: string): string');
    const end = src.indexOf('async function sendText', start);
    if (start === -1 || end === -1 || end <= start) {
      console.error('Target patch tidak ketemu: replace deliveryJid block');
      process.exit(1);
    }
    src = `${src.slice(0, start)}${deliveryBlock}\n${src.slice(end)}`;
    changed = true;
  }
} else {
  const marker = 'async function sendText(';
  const pos = src.indexOf(marker);
  if (pos === -1) {
    console.error('Target patch tidak ketemu: insert deliveryJid block');
    process.exit(1);
  }
  src = `${src.slice(0, pos)}${deliveryBlock}\n${src.slice(pos)}`;
  changed = true;
}

const afterJidOld = "const jid = fromMe ? rootJid(rawJid) : findLikelyCanonicalForIncoming(rawJid, m.pushName, m as any); const senderName =";
const afterJidNew = "const jid = fromMe ? rootJid(rawJid) : findLikelyCanonicalForIncoming(rawJid, m.pushName, m as any); if (!fromMe) rememberDeliveryJid(jid, rawJid); const senderName =";
if (!src.includes('rememberDeliveryJid(jid, rawJid)')) {
  if (src.includes(afterJidOld)) {
    src = src.replace(afterJidOld, afterJidNew);
    changed = true;
  } else {
    console.error('Target patch tidak ketemu: remember inbound delivery JID');
    process.exit(1);
  }
}

if (changed) {
  fs.writeFileSync(file, src);
  console.log('patched: inbound raw JID is remembered for encrypted replies.');
} else {
  console.log('delivery session memory already patched.');
}

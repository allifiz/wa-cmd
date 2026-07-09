#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), 'src', 'index.ts');
let src = fs.readFileSync(file, 'utf8');
let changed = false;

const helper = "function resolveLinkEndpoint(raw: string, side: 'from' | 'to'): string { const v = raw.trim(); if (!v) throw new Error('Target link kosong.'); if (v === '.' || v === 'this') { if (!currentChat) throw new Error('Tidak sedang di room chat.'); return currentChat; } if (side === 'to' && /^62\\d{8,14}$/.test(v)) return `${v}@s.whatsapp.net`; if (side === 'from' && mode !== 'chat') { const byIndex = resolveIndex(v); if (byIndex) return rootJid(byIndex); } return resolveTarget(v); }";

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

const oldFn = "function linkJids(fromRaw: string, toRaw: string): void { const from = resolveTarget(fromRaw); const to = resolveTarget(toRaw); if (!isLidJid(from) && !isLidJid(rootJid(from))) throw new Error('Sumber link harus @lid / room LID. Contoh: /link 1 2'); const canonical = mergeJidData(from, to); saveData(); console.log(chalk.green(`Linked ${from} -> ${nameOf(canonical)} (${canonical})`)); render(); }";
const newFn = "function linkJids(fromRaw: string, toRaw: string): void { const from = resolveLinkEndpoint(fromRaw, 'from'); const to = resolveLinkEndpoint(toRaw, 'to'); if (!isLidJid(from) && !isLidJid(rootJid(from))) throw new Error('Sumber link harus @lid / room LID. Contoh: /link 1 628xxx atau /link . 628xxx'); const canonical = mergeJidData(from, to); saveData(); render(); console.log(chalk.green(`Linked ${from} -> ${nameOf(canonical)} (${canonical})`)); }";

if (!src.includes("const from = resolveLinkEndpoint(fromRaw, 'from')")) {
  if (!src.includes(oldFn)) {
    console.error('Target patch tidak ketemu: replace linkJids');
    process.exit(1);
  }
  src = src.replace(oldFn, newFn);
  changed = true;
}

if (changed) {
  fs.writeFileSync(file, src);
  console.log('patched: /link resolves explicit 628 phone targets safely and shows result.');
} else {
  console.log('link command already patched.');
}

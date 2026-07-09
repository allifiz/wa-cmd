#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), 'src', 'index.ts');
let src = fs.readFileSync(file, 'utf8');
let changed = false;

const newText = "function repairJidLinksFromHistory(): void { for (const [from, to] of [...jidLinks.entries()]) { if (!isLidJid(from)) continue; const target = rootJid(to); const fromBare = from.replace('@lid', ''); const targetBare = target.replace('@s.whatsapp.net', '').replace('@lid', ''); if (isPhoneJid(target) && fromBare === targetBare) { jidLinks.delete(from); continue; } if (!isPhoneJid(target) && !target.endsWith('@g.us')) jidLinks.delete(from); } }";

if (!src.includes('fromBare === targetBare')) {
  const start = src.indexOf('function repairJidLinksFromHistory(): void');
  const end = start >= 0 ? src.indexOf('function unwrapMessage', start) : -1;
  if (start === -1 || end === -1 || end <= start) {
    console.error('Target patch tidak ketemu: bad numeric LID link repair');
    process.exit(1);
  }
  src = `${src.slice(0, start)}${newText}\n${src.slice(end)}`;
  changed = true;
}

if (changed) {
  fs.writeFileSync(file, src);
  console.log('patched: bad numeric LID links are removed on startup.');
} else {
  console.log('JID link safety already patched.');
}

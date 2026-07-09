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

patch(
  'refresh preview after purge',
  "function refreshChatPreview(jidRaw: string): void { const jid = rootJid(jidRaw); const latest = (messages.get(jid) ?? []).at(-1); const ch = chats.get(jid); if (ch && latest) chats.set(jid, { ...ch, lastMessage: latest.text, lastAt: latest.at }); }",
  "function refreshChatPreview(jidRaw: string): void { const jid = rootJid(jidRaw); const latest = (messages.get(jid) ?? []).at(-1); const ch = chats.get(jid); if (!ch) return; if (latest) chats.set(jid, { ...ch, lastMessage: latest.text, lastAt: latest.at }); else chats.set(jid, { ...ch, lastMessage: '[pesan lama dibersihkan]' }); }",
  "lastMessage: '[pesan lama dibersihkan]'"
);

patch(
  'delete due censored messages',
  "function censorDueMessages(force = false): void { if (!messageCensorEnabled()) return; const now = Date.now(); let changed = false; for (const [jid, list] of messages.entries()) { let touched = false; for (const m of list) { if (isTerminalCensored(m) || !m.seenAt) continue; if (!force && now - m.seenAt < MESSAGE_CENSOR_DELAY_MS) continue; m.text = terminalCensorText(m.text); m.censoredAt = now; touched = true; changed = true; } if (touched) refreshChatPreview(jid); } if (changed) { saveData(); render(); } }",
  "function censorDueMessages(force = false): void { if (!messageCensorEnabled()) return; const now = Date.now(); let changed = false; for (const [jid, list] of messages.entries()) { const kept = list.filter((m) => { if (isTerminalCensored(m)) return false; if (!m.seenAt) return true; if (!force && now - m.seenAt < MESSAGE_CENSOR_DELAY_MS) return true; return false; }); if (kept.length !== list.length) { if (kept.length) messages.set(jid, kept); else messages.delete(jid); refreshChatPreview(jid); changed = true; } } if (changed) { saveData(); render(); } }",
  'const kept = list.filter((m) => {'
);

patch(
  'sensor status wording delete',
  "function censorStatus(): void { console.log(messageCensorEnabled() ? chalk.green('Message sensor ON. Pesan yang dibuka/dibalas akan disensor setelah 5 menit.') : chalk.yellow('Message sensor OFF.')); }",
  "function censorStatus(): void { console.log(messageCensorEnabled() ? chalk.green('Message cleanup ON. Pesan yang dibuka/dibalas akan dihapus dari cache setelah 5 menit.') : chalk.yellow('Message cleanup OFF.')); }",
  'Message cleanup ON.'
);

patch(
  'sensor command wording delete',
  "if (sub === 'now') { censorDueMessages(true); console.log(chalk.green('Pesan yang sudah ditandai dibuka/dibalas sudah disensor.')); return; } throw new Error('Format: /sensor status | on | off | now');",
  "if (sub === 'now') { censorDueMessages(true); console.log(chalk.green('Pesan yang sudah ditandai dibuka/dibalas sudah dihapus dari cache.')); return; } throw new Error('Format: /sensor status | on | off | now');",
  'sudah dihapus dari cache'
);

if (changed) {
  fs.writeFileSync(file, src);
  console.log('patched: censored/due messages are deleted from messages.json.');
} else {
  console.log('delete censored messages already patched.');
}

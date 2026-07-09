#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), 'src', 'index.ts');
let src = fs.readFileSync(file, 'utf8');
let changed = false;

if (src.includes('function deleteLocalChat(') && src.includes("cmd === '/delete'") && src.includes("lower.startsWith('d ')")) {
  console.log('delete chat command already patched.');
  process.exit(0);
}

function replace(label, from, to) {
  if (!src.includes(from)) {
    console.error(`Target patch tidak ketemu: ${label}`);
    process.exit(1);
  }
  src = src.replace(from, to);
  changed = true;
}

function replaceOptional(from, to) {
  if (src.includes(from)) {
    src = src.replace(from, to);
    changed = true;
  }
}

if (!src.includes('function deleteLocalChat(')) {
  replace(
    'insert deleteLocalChat after linkJids',
    "function linkJids(fromRaw: string, toRaw: string): void { const from = resolveTarget(fromRaw); const to = resolveTarget(toRaw); if (!isLidJid(from) && !isLidJid(rootJid(from))) throw new Error('Sumber link harus @lid / room LID. Contoh: /link 1 2'); const canonical = mergeJidData(from, to); saveData(); console.log(chalk.green(`Linked ${from} -> ${nameOf(canonical)} (${canonical})`)); render(); }",
    "function linkJids(fromRaw: string, toRaw: string): void { const from = resolveTarget(fromRaw); const to = resolveTarget(toRaw); if (!isLidJid(from) && !isLidJid(rootJid(from))) throw new Error('Sumber link harus @lid / room LID. Contoh: /link 1 2'); const canonical = mergeJidData(from, to); saveData(); console.log(chalk.green(`Linked ${from} -> ${nameOf(canonical)} (${canonical})`)); render(); }\nfunction deleteLocalChat(targetRaw: string): void { const target = targetRaw.trim() || '.'; const jid = resolveTarget(target); const label = nameOf(jid); chats.delete(jid); messages.delete(jid); for (const [id, item] of [...media.entries()]) if (item.jid === jid) media.delete(id); for (const [from, to] of [...jidLinks.entries()]) if (from === jid || to === jid) jidLinks.delete(from); for (const [alias, aliasJid] of Object.entries(aliases)) if (aliasJid === jid || rootJid(aliasJid) === jid) delete aliases[alias]; delete localNames[jid]; if (settings.viewOnceForwardJid === jid) delete settings.viewOnceForwardJid; if (currentChat === jid) { currentChat = null; mode = 'inbox'; pendingQuote = null; } saveData(); console.log(chalk.yellow(`Deleted local chat cache: ${label} (${jid})`)); render(); }"
  );
}

if (!src.includes("cmd === '/delete'")) {
  replace(
    'slash delete command',
    "if (cmd === '/link' || cmd === '/merge') { const from = args.shift(); const to = args.join(' '); if (!from || !to) throw new Error('Format: /link <lid-target> <real-target>. Contoh: /link 1 2'); return linkJids(from, to); } if (cmd === '/close' || cmd === '/back')",
    "if (cmd === '/link' || cmd === '/merge') { const from = args.shift(); const to = args.join(' '); if (!from || !to) throw new Error('Format: /link <lid-target> <real-target>. Contoh: /link 1 2'); return linkJids(from, to); } if (cmd === '/delete' || cmd === '/del' || cmd === '/remove' || cmd === '/rm') { const target = args.join(' '); if (!target && !currentChat) throw new Error('Format: /delete <target>. Contoh: /delete 3'); return deleteLocalChat(target || '.'); } if (cmd === '/close' || cmd === '/back')"
  );
}

if (!src.includes("lower.startsWith('d ')")) {
  replace(
    'shortcut delete command',
    "if (lower.startsWith('r ')) { const [, idx, ...msg] = line.split(' '); const jid = resolveIndex(idx); if (!jid || !msg.join(' ')) throw new Error('Format: r <no> <pesan>'); return sendText(sock, jid, msg.join(' ')); }",
    "if (lower.startsWith('d ') || lower.startsWith('del ')) { const [, ...targetParts] = line.split(' '); const target = targetParts.join(' '); if (!target) throw new Error('Format: d <target>. Contoh: d 3'); return deleteLocalChat(target); } if (lower.startsWith('r ')) { const [, idx, ...msg] = line.split(' '); const jid = resolveIndex(idx); if (!jid || !msg.join(' ')) throw new Error('Format: r <no> <pesan>'); return sendText(sock, jid, msg.join(' ')); }"
  );
}

replaceOptional(
  "console.log(chalk.gray('1-10 open | j <target> jump | q <no> quote | reply <no> mode | n/p page | s/c search | v <media-id> | /help'));",
  "console.log(chalk.gray('1-10 open | j <target> jump | d <no> delete | q <no> quote | n/p page | s/c search | /help'));"
);

replaceOptional(
  "  j <nama/no>           jump / pindah chat cepat\n  n / p                 next / prev page",
  "  j <nama/no>           jump / pindah chat cepat\n  d <no/target>         hapus cache chat lokal dari inbox\n  n / p                 next / prev page"
);

replaceOptional(
  "  /link <lid-target> <real-target> | /merge <lid-target> <real-target>\n  /send <target> <pesan> | /reply <no> [pesan]",
  "  /link <lid-target> <real-target> | /merge <lid-target> <real-target>\n  /delete <target> | /del <target> | /rm <target>\n  /send <target> <pesan> | /reply <no> [pesan]"
);

if (changed) {
  fs.writeFileSync(file, src);
  console.log('patched: added local delete chat command (d/del and /delete).');
} else {
  console.log('no changes needed.');
}

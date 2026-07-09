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
    return true;
  }
  return false;
}

const deleteLocalChatFn = "function deleteLocalChat(targetRaw: string): void { const target = targetRaw.trim() || '.'; const jid = resolveTarget(target); const label = nameOf(jid); chats.delete(jid); messages.delete(jid); for (const [id, item] of [...media.entries()]) if (item.jid === jid) media.delete(id); for (const [from, to] of [...jidLinks.entries()]) if (from === jid || to === jid) jidLinks.delete(from); for (const [alias, aliasJid] of Object.entries(aliases)) if (aliasJid === jid || rootJid(aliasJid) === jid) delete aliases[alias]; delete localNames[jid]; if (settings.viewOnceForwardJid === jid) delete settings.viewOnceForwardJid; if (currentChat === jid) { currentChat = null; mode = 'inbox'; pendingQuote = null; } saveData(); console.log(chalk.yellow(`Deleted local chat cache: ${label} (${jid})`)); render(); }";

if (!src.includes('function deleteLocalChat(')) {
  const helpPos = src.indexOf('function help(): void');
  if (helpPos === -1) {
    console.error('Target patch tidak ketemu: insert deleteLocalChat before help');
    process.exit(1);
  }
  src = `${src.slice(0, helpPos)}${deleteLocalChatFn}\n${src.slice(helpPos)}`;
  changed = true;
}

if (!src.includes("cmd === '/delete'")) {
  const deleteCmd = "if (cmd === '/delete' || cmd === '/del' || cmd === '/remove' || cmd === '/rm') { const target = args.join(' '); if (!target && !currentChat) throw new Error('Format: /delete <target>. Contoh: /delete 3'); return deleteLocalChat(target || '.'); } ";
  const patterns = [
    {
      from: "return linkJids(from, to); } if (cmd === '/close' || cmd === '/back')",
      to: `return linkJids(from, to); } ${deleteCmd}if (cmd === '/close' || cmd === '/back')`,
    },
    {
      from: "return unmarkSelfChat(target); } if (cmd === '/close' || cmd === '/back')",
      to: `return unmarkSelfChat(target); } ${deleteCmd}if (cmd === '/close' || cmd === '/back')`,
    },
    {
      from: "if (cmd === '/close' || cmd === '/back')",
      to: `${deleteCmd}if (cmd === '/close' || cmd === '/back')`,
    },
  ];
  const hit = patterns.find((x) => src.includes(x.from));
  if (hit) {
    src = src.replace(hit.from, hit.to);
    changed = true;
  } else {
    console.warn('slash delete command target tidak ketemu; lanjut tanpa stop.');
  }
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

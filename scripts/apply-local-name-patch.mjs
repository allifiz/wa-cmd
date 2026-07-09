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

patch('local name store', (s) => {
  let out = s;
  if (!out.includes('type LocalNameStore')) {
    out = out.replace(
      'type JidLinkStore = Record<string, string>;',
      'type JidLinkStore = Record<string, string>;\ntype LocalNameStore = Record<string, string>;'
    );
  }
  if (!out.includes('localNames: path.join')) {
    out = out.replace(
      "jidLinks: path.join(DATA, 'jid-links.json'),",
      "jidLinks: path.join(DATA, 'jid-links.json'),\n  localNames: path.join(DATA, 'local-names.json'),"
    );
  }
  if (!out.includes('let localNames: LocalNameStore')) {
    out = out.replace(
      'let aliases: AliasStore = {};',
      'let aliases: AliasStore = {};\nlet localNames: LocalNameStore = {};'
    );
  }
  if (!out.includes('localNames = readJson<LocalNameStore>')) {
    out = out.replace(
      'aliases = readJson<AliasStore>(FILES.aliases, {});',
      'aliases = readJson<AliasStore>(FILES.aliases, {});\n  localNames = readJson<LocalNameStore>(FILES.localNames, {});'
    );
  }
  if (!out.includes('writeJson(FILES.localNames')) {
    out = out.replace(
      'writeJson(FILES.aliases, aliases);',
      'writeJson(FILES.aliases, aliases);\n  writeJson(FILES.localNames, localNames);'
    );
  }
  return out;
});

patch('local name helpers', (s) => {
  if (s.includes('function localNameOf(')) return s;
  const marker = '\nfunction aliasOf(jidRaw: string): string | null {';
  const idx = s.indexOf(marker);
  if (idx === -1) return s;
  const block = `
function localNameOf(jidRaw: string): string | null {
  const jid = rootJid(jidRaw);
  return localNames[jid] ?? localNames[jidRaw] ?? null;
}
function setLocalName(jidRaw: string, nameRaw: string): void {
  const jid = rootJid(jidRaw);
  const name = nameRaw.trim();
  if (!name) throw new Error('Nama kosong. Format: /name <target> <nama>');
  localNames[jid] = name;
  const ch = chats.get(jid);
  if (ch) chats.set(jid, { ...ch, name });
  const c = contacts.get(jid);
  if (c) contacts.set(jid, { ...c, name, updatedAt: Date.now() });
  saveData();
}
function removeLocalName(jidRaw: string): void {
  const jid = rootJid(jidRaw);
  delete localNames[jid];
  saveData();
}
`;
  return `${s.slice(0, idx)}${block}${s.slice(idx)}`;
});

patch('prefer local names', (s) => {
  let out = s;
  out = out.replace(
    'return [c?.name, c?.notify, c?.verifiedName, ch?.name, aliasOf(jid)].filter(Boolean) as string[];',
    'return [localNameOf(jid), c?.name, c?.notify, c?.verifiedName, ch?.name, aliasOf(jid)].filter(Boolean) as string[];'
  );
  out = out.replace(
    'return a ? `@${a}` : contactName(jid) ?? chats.get(jid)?.name ?? jid;',
    'return localNameOf(jid) ?? (a ? `@${a}` : contactName(jid) ?? chats.get(jid)?.name ?? jid);'
  );
  out = out.replace(
    'const safeName = fromMe ? (contactName(jid) ?? old?.name ?? jid) : (contactName(jid) ?? old?.name ?? name);',
    'const local = localNameOf(jid);\n  const safeName = local ?? (fromMe ? (contactName(jid) ?? old?.name ?? jid) : (contactName(jid) ?? old?.name ?? name));'
  );
  return out;
});

patch('name commands', (s) => {
  let out = s;
  if (!out.includes('/name <target> <nama>')) {
    out = out.replace(
      '  /view <media-id> | /viewonce status | /viewonce set <target>\n',
      '  /view <media-id> | /name <target> <nama> | /unname <target>\n  /viewonce status | /viewonce set <target>\n'
    );
  }
  if (!out.includes("if (cmd === '/name')")) {
    out = out.replace(
      "if (cmd === '/aliases') return printAliases();\n  if (cmd === '/view') return openMedia(args[0] ?? '');",
      "if (cmd === '/aliases') return printAliases();\n  if (cmd === '/name') { const target = args.shift(); const name = args.join(' '); if (!target || !name) throw new Error('Format: /name <target> <nama>'); setLocalName(resolveTarget(target), name); console.log(chalk.green(`Nama lokal disimpan: ${name}`)); return render(); }\n  if (cmd === '/unname') { const target = args.join(' '); if (!target) throw new Error('Format: /unname <target>'); removeLocalName(resolveTarget(target)); console.log(chalk.yellow('Nama lokal dihapus.')); return render(); }\n  if (cmd === '/view') return openMedia(args[0] ?? '');"
    );
  }
  return out;
});

if (changed) fs.writeFileSync(file, src);

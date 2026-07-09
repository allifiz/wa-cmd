#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), 'src', 'index.ts');
let src = fs.readFileSync(file, 'utf8');
let changed = false;

function patchOnce(label, fn) {
  const before = src;
  src = fn(src);
  if (src !== before) {
    changed = true;
    console.log(`[patch] ${label}`);
  }
}

patchOnce('node-notifier import', (s) => {
  if (s.includes("createRequire(import.meta.url)") || s.includes("node-notifier")) return s;
  return s.replace(
    "import qrcode from 'qrcode-terminal';",
    "import qrcode from 'qrcode-terminal';\nimport { createRequire } from 'node:module';\n\nconst require = createRequire(import.meta.url);\nconst notifier = require('node-notifier');"
  );
});

patchOnce('windows toaster notifier', (s) => {
  let out = s.replace(
    "const notifier = require('node-notifier');",
    "const notifierPkg = require('node-notifier');\nconst WindowsToaster = notifierPkg.WindowsToaster;\nconst notifier = process.platform === 'win32' && WindowsToaster ? new WindowsToaster({ withFallback: false }) : notifierPkg;"
  );
  out = out.replace('new WindowsToaster({ withFallback: true })', 'new WindowsToaster({ withFallback: false })');
  return out;
});

patchOnce('native notification', (s) => {
  const newBlock = `function terminalBell(): void { try { process.stdout.write('\\x07'); } catch { /* ignore */ } }
function notifyNewMessage(sender: string, message: string): void {
  const now = Date.now();
  if (now - lastNotificationAt < NOTIFICATION_COOLDOWN_MS) return;
  lastNotificationAt = now;
  try {
    notifier.notify({
      title: sender || 'WA CMD',
      message: short(message.replace(/[\\r\\n]+/g, ' '), 180),
      sound: true,
      wait: false,
      appID: 'WA CMD',
    });
  } catch {
    terminalBell();
  }
}`;

  const oldWithBalloon = /function psQuote\(s: string\): string \{[\s\S]*?\nfunction notifyNewMessage\(sender: string, message: string\): void \{[\s\S]*?\n\}/;
  const oldNotifierOnly = /function terminalBell\(\): void \{[\s\S]*?\nfunction notifyNewMessage\(sender: string, message: string\): void \{[\s\S]*?\n\}/;

  if (oldWithBalloon.test(s)) return s.replace(oldWithBalloon, newBlock);
  if (oldNotifierOnly.test(s)) return s.replace(oldNotifierOnly, newBlock);
  return s;
});

patchOnce('message censor types and constants', (s) => {
  let out = s;
  if (!out.includes('seenAt?: number; censoredAt?: number')) {
    out = out.replace(
      'type StoredMessage = { jid: string; fromMe: boolean; senderName: string; text: string; at: number };',
      'type StoredMessage = { jid: string; fromMe: boolean; senderName: string; text: string; at: number; seenAt?: number; censoredAt?: number };'
    );
  }
  if (!out.includes('messageCensorEnabled?: boolean')) {
    out = out.replace(
      'type SettingsStore = { viewOnceForwardJid?: string };',
      'type SettingsStore = { viewOnceForwardJid?: string; messageCensorEnabled?: boolean };'
    );
  }
  if (!out.includes('MESSAGE_CENSOR_DELAY_MS')) {
    out = out.replace(
      'const LID_REPLY_LINK_WINDOW_MS = 15 * 60 * 1000;',
      'const LID_REPLY_LINK_WINDOW_MS = 15 * 60 * 1000;\nconst MESSAGE_CENSOR_DELAY_MS = 5 * 60 * 1000;'
    );
  }
  if (!out.includes('censorTimer: NodeJS.Timeout')) {
    out = out.replace(
      'let lastNotificationAt = 0;',
      'let lastNotificationAt = 0;\nlet censorTimer: NodeJS.Timeout | null = null;'
    );
  }
  return out;
});

patchOnce('message censor engine', (s) => {
  if (s.includes('function messageCensorEnabled()')) return s;
  const marker = '\nfunction loadData(): void {';
  const idx = s.indexOf(marker);
  if (idx === -1) return s;
  const block = `
function messageCensorEnabled(): boolean { return Boolean(settings.messageCensorEnabled); }
function isTerminalCensored(m: StoredMessage): boolean { return Boolean(m.censoredAt) || m.text.startsWith('[░░ SENSOR'); }
function terminalCensorText(text: string): string {
  const normalized = text.replace(/[\r\n]+/g, ' ').trim();
  const blocks = Math.min(32, Math.max(8, Array.from(normalized).length || 8));
  return \`[░░ SENSOR ░░] \${'█'.repeat(blocks)}\`;
}
function refreshChatPreview(jidRaw: string): void {
  const jid = rootJid(jidRaw);
  const ch = chats.get(jid);
  if (!ch) return;
  const list = dedupeMessageList(messages.get(jid) ?? []);
  const last = list.at(-1);
  if (last) chats.set(jid, { ...ch, lastMessage: last.text, lastAt: last.at });
}
function censorDueMessages(force = false): boolean {
  if (!force && !messageCensorEnabled()) return false;
  const now = Date.now();
  const touched = new Set<string>();
  let changed = false;

  for (const [jid, list] of messages.entries()) {
    for (const m of list) {
      if (isTerminalCensored(m)) continue;
      const eligibleAt = m.seenAt ?? 0;
      if (!eligibleAt) continue;
      if (!force && now - eligibleAt < MESSAGE_CENSOR_DELAY_MS) continue;
      m.text = terminalCensorText(m.text);
      m.censoredAt = now;
      touched.add(jid);
      changed = true;
    }
  }

  for (const jid of touched) refreshChatPreview(jid);
  return changed;
}
function nextCensorDelay(): number | null {
  if (!messageCensorEnabled()) return null;
  const now = Date.now();
  let next: number | null = null;
  for (const list of messages.values()) {
    for (const m of list) {
      if (isTerminalCensored(m) || !m.seenAt) continue;
      const due = m.seenAt + MESSAGE_CENSOR_DELAY_MS;
      if (next === null || due < next) next = due;
    }
  }
  return next === null ? null : Math.max(250, next - now);
}
function scheduleCensorSweep(): void {
  if (censorTimer) clearTimeout(censorTimer);
  const delay = nextCensorDelay();
  if (delay === null) { censorTimer = null; return; }
  censorTimer = setTimeout(() => {
    const changed = censorDueMessages();
    if (changed) {
      saveData();
      if (mode === 'inbox' || mode === 'chat') render();
    }
    scheduleCensorSweep();
  }, delay);
}
function markMessagesSeenForCensor(jidRaw: string): void {
  if (!messageCensorEnabled()) return;
  const jid = rootJid(jidRaw);
  const list = messages.get(jid) ?? [];
  const now = Date.now();
  let changed = false;
  for (const m of list) {
    if (isTerminalCensored(m) || m.seenAt) continue;
    m.seenAt = now;
    changed = true;
  }
  if (changed) { saveData(); scheduleCensorSweep(); }
}
function markChatRepliedForCensor(jidRaw: string): void {
  if (!messageCensorEnabled()) return;
  markMessagesSeenForCensor(jidRaw);
}
function censorStatus(): void {
  const state = messageCensorEnabled() ? chalk.green('ON') : chalk.yellow('OFF');
  console.log(\`Sensor message: \${state} \${chalk.gray('(delay 5 menit setelah chat dilihat/dibalas)')}\`);
}
function censorCommand(args: string[]): void {
  const sub = args.shift()?.toLowerCase() ?? 'status';
  if (sub === 'status') return censorStatus();
  if (sub === 'on' || sub === 'enable') {
    settings.messageCensorEnabled = true;
    saveData();
    if (currentChat) markMessagesSeenForCensor(currentChat);
    scheduleCensorSweep();
    console.log(chalk.green('Sensor message ON. Pesan lokal yang dilihat/dibalas akan disensor setelah 5 menit.'));
    return;
  }
  if (sub === 'off' || sub === 'disable') {
    settings.messageCensorEnabled = false;
    if (censorTimer) clearTimeout(censorTimer);
    censorTimer = null;
    saveData();
    console.log(chalk.yellow('Sensor message OFF. Pesan yang sudah terlanjur disensor tidak bisa dikembalikan dari cache lokal.'));
    return;
  }
  if (sub === 'now') {
    if (currentChat) markMessagesSeenForCensor(currentChat);
    const changed = censorDueMessages(true);
    if (changed) { saveData(); render(); }
    console.log(changed ? chalk.green('Pesan lokal yang sudah ditandai langsung disensor.') : chalk.yellow('Belum ada pesan lokal yang bisa disensor.'));
    return;
  }
  throw new Error('Format: /sensor status | on | off | now');
}
`;
  return `${s.slice(0, idx)}${block}${s.slice(idx)}`;
});

patchOnce('message censor hooks', (s) => {
  let out = s;
  if (!out.includes('markMessagesSeenForCensor(currentChat);')) {
    out = out.replace(
      'if (ch) chats.set(currentChat, { ...ch, unread: 0 });',
      'if (ch) chats.set(currentChat, { ...ch, unread: 0 });\n  markMessagesSeenForCensor(currentChat);'
    );
  }
  out = out.replace(
    "console.log(chalk.gray('Ketik pesan langsung. b/back kembali. v <media-id> buka foto. /vo untuk anti-viewonce.'));",
    "console.log(chalk.gray('Ketik pesan langsung. b/back kembali. v <media-id> buka foto. /vo anti-viewonce. /sensor privasi.'));"
  );
  out = out.replace(
    'for (const m of list) console.log(`${chalk.gray(time(m.at))} ${m.fromMe ? chalk.green(\'kamu\') : chalk.magenta(m.senderName || \'dia\')}: ${m.text}`);',
    'for (const m of list) console.log(`${chalk.gray(time(m.at))} ${m.fromMe ? chalk.green(\'kamu\') : chalk.magenta(m.senderName || \'dia\')}: ${m.censoredAt ? chalk.gray(m.text) : m.text}`);'
  );
  if (!out.includes('markChatRepliedForCensor(jid);')) {
    out = out.replace(
      "pushMsg({ jid, fromMe: true, senderName: 'kamu', text, at });\n  saveData();",
      "pushMsg({ jid, fromMe: true, senderName: 'kamu', text, at });\n  markChatRepliedForCensor(jid);\n  saveData();"
    );
  }
  out = out.replace(
    '1-10 open | n/p page | s <nama> search | c <nama> contacts | r <no> <pesan> | v <media-id> | /vo | b back | /help',
    '1-10 open | n/p page | s <nama> search | c <nama> contacts | r <no> <pesan> | v <media-id> | /vo | /sensor | b back | /help'
  );
  out = out.replace(
    '  /viewonce off | /viewonce list | /viewonce open <id>\n  /clear | /logout | /exit',
    '  /viewonce off | /viewonce list | /viewonce open <id>\n  /sensor status | /sensor on | /sensor off | /sensor now\n  /clear | /logout | /exit'
  );
  if (!out.includes("if (cmd === '/sensor') return censorCommand(args);")) {
    out = out.replace(
      "if (cmd === '/viewonce' || cmd === '/vo') return viewOnceCommand(args);\n  if (cmd === '/clear') return render();",
      "if (cmd === '/viewonce' || cmd === '/vo') return viewOnceCommand(args);\n  if (cmd === '/sensor') return censorCommand(args);\n  if (cmd === '/clear') return render();"
    );
  }
  if (!out.includes('scheduleCensorSweep();\nprocess.on')) {
    out = out.replace(
      'loadData();\nprocess.on(\'SIGINT\', () => exitApp(0));',
      'loadData();\ncensorDueMessages();\nscheduleCensorSweep();\nprocess.on(\'SIGINT\', () => exitApp(0));'
    );
  }
  return out;
});

patchOnce('jid-link resolver', (s) => {
  if (s.includes('function sameBareNumber')) return s;
  const marker = "function findLikelyCanonicalForIncoming(rawJid: string, pushName: string | undefined, at: number): string {";
  const idx = s.indexOf(marker);
  if (idx === -1) return s;
  const endMarker = "\nfunction repairJidLinksFromHistory(): void {";
  const end = s.indexOf(endMarker, idx);
  if (end === -1) return s;
  const replacement = `function sameBareNumber(a: string, b: string): boolean {
  const ax = a.replace(/\\D/g, '');
  const bx = b.replace(/\\D/g, '');
  return Boolean(ax && bx && (ax === bx || ax.endsWith(bx) || bx.endsWith(ax)));
}

function findManualLinkedJid(rawJid: string, pushName?: string): string | null {
  const id = jidNormalizedUser(rawJid) ?? rawJid;
  const linked = rootJid(id);
  if (linked !== id) return linked;

  const push = norm(pushName ?? '');
  const candidates = [...chats.keys(), ...contacts.keys()]
    .map((jid) => rootJid(jid))
    .filter((jid, i, arr) => arr.indexOf(jid) === i && jid !== id);

  const byExactName = push
    ? candidates.find((jid) => searchableNames(jid).some((name) => norm(name) === push))
    : null;
  if (byExactName) return mergeJidData(id, byExactName);

  const byBareNumber = candidates.find((jid) => sameBareNumber(jid, id));
  if (byBareNumber) return mergeJidData(id, byBareNumber);

  return null;
}

function findLikelyCanonicalForIncoming(rawJid: string, pushName: string | undefined, at: number): string {
  const id = jidNormalizedUser(rawJid) ?? rawJid;
  const manual = findManualLinkedJid(id, pushName);
  if (manual) return manual;
  if (!isLidJid(id)) return rootJid(id);

  const recentOutgoing = [...chats.keys()]
    .map((jid) => rootJid(jid))
    .filter((jid, i, arr) => arr.indexOf(jid) === i && jid !== id && isPhoneJid(jid))
    .map((jid) => ({ jid, outAt: latestMessageAt(jid, true) }))
    .filter((x) => x.outAt > 0 && at >= x.outAt && at - x.outAt <= LID_REPLY_LINK_WINDOW_MS)
    .sort((a, b) => b.outAt - a.outAt)[0];

  return recentOutgoing ? mergeJidData(id, recentOutgoing.jid) : id;
}`;
  return `${s.slice(0, idx)}${replacement}${s.slice(end)}`;
});

patchOnce('nullable pushName', (s) => {
  return s.replaceAll(
    'findLikelyCanonicalForIncoming(rawJid, m.pushName, at)',
    'findLikelyCanonicalForIncoming(rawJid, m.pushName ?? undefined, at)'
  );
});

patchOnce('notify every incoming message', (s) => {
  let out = s.replace(
    "if (!fromMe && currentChat !== jid) notifyNewMessage(nameOf(jid), text);",
    "if (!fromMe) notifyNewMessage(nameOf(jid), text);"
  );
  out = out.replace(
    "if (!fromMe && (!currentChat || rootJid(currentChat) !== rootJid(jid))) notifyNewMessage(nameOf(jid), text);",
    "if (!fromMe) notifyNewMessage(nameOf(jid), text);"
  );
  return out;
});

if (changed) fs.writeFileSync(file, src);

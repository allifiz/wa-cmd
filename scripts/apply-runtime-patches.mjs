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
  return s.replace(
    "const notifier = require('node-notifier');",
    "const notifierPkg = require('node-notifier');\nconst WindowsToaster = notifierPkg.WindowsToaster;\nconst notifier = process.platform === 'win32' && WindowsToaster ? new WindowsToaster({ withFallback: true }) : notifierPkg;"
  );
});

patchOnce('native notification', (s) => {
  if (s.includes('notifier.notify({')) return s;
  const oldBlock = /function psQuote\(s: string\): string \{ return s\.replace\(\/'\/g, "''"\); \}\nfunction terminalBell\(\): void \{ try \{ process\.stdout\.write\('\\x07'\); \} catch \{ \/\* ignore \*\/ \} \}\nfunction windowsBalloon\(title: string, message: string\): void \{[\s\S]*?\n\}\nfunction notifyNewMessage\(sender: string, message: string\): void \{\n  const now = Date\.now\(\);\n  if \(now - lastNotificationAt < NOTIFICATION_COOLDOWN_MS\) return;\n  lastNotificationAt = now;\n  terminalBell\(\);\n  windowsBalloon\('WA CMD', `\$\{sender\}: \$\{message\}`\);\n\}/;
  const newBlock = `function terminalBell(): void { try { process.stdout.write('\\x07'); } catch { /* ignore */ } }
function notifyNewMessage(sender: string, message: string): void {
  const now = Date.now();
  if (now - lastNotificationAt < NOTIFICATION_COOLDOWN_MS) return;
  lastNotificationAt = now;
  terminalBell();
  try {
    notifier.notify({
      title: sender || 'WA CMD',
      message: short(message.replace(/[\\r\\n]+/g, ' '), 180),
      sound: true,
      wait: false,
      appID: 'WA CMD',
    });
  } catch {
    // notification should never break the WhatsApp client
  }
}`;
  return s.replace(oldBlock, newBlock);
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

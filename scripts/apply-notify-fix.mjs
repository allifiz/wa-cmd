#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), 'src', 'index.ts');
let src = fs.readFileSync(file, 'utf8');
let changed = false;

function addCreateRequireImport() {
  if (src.includes("import { createRequire } from 'node:module';")) return;
  const line = "import { createRequire } from 'node:module';\n";
  const shebang = src.match(/^#![^\n]*\r?\n/);
  if (shebang) {
    src = `${shebang[0]}${line}${src.slice(shebang[0].length)}`;
  } else {
    src = `${line}${src}`;
  }
  changed = true;
}

function insertAfterRegex(label, patterns, text) {
  if (src.includes(text.trim())) return;
  for (const pattern of patterns) {
    const match = src.match(pattern);
    if (match?.index !== undefined) {
      const insertAt = match.index + match[0].length;
      src = `${src.slice(0, insertAt)}${text}${src.slice(insertAt)}`;
      changed = true;
      return;
    }
  }
  console.error(`Target patch tidak ketemu: ${label}`);
  process.exit(1);
}

addCreateRequireImport();

const notifierSetup = "const require = createRequire(import.meta.url);\nconst notifierPkg = require('node-notifier');\nconst WindowsToaster = notifierPkg.WindowsToaster;\nconst notifier = process.platform === 'win32' && WindowsToaster ? new WindowsToaster({ withFallback: false }) : notifierPkg;\n";

if (!src.includes('const require = createRequire(import.meta.url);')) {
  insertAfterRegex('add notifier setup', [
    /const rl = readline\.createInterface\(\{ input: process\.stdin, output: process\.stdout \}\);\r?\n/,
    /let pendingQuote: StoredMessage \| null = null;\r?\n/,
    /let activeUnreadJids: string\[\] = \[\];\r?\n/,
  ], notifierSetup);
}

const newNotifierNotify = "function terminalBell(): void { try { process.stdout.write('\\x07'); } catch { /* ignore */ } }\nfunction notifyNewMessage(sender: string, message: string): void { const now = Date.now(); if (now - lastNotificationAt < NOTIFICATION_COOLDOWN_MS) return; lastNotificationAt = now; terminalBell(); const title = 'WA CMD'; const body = `${short(sender.replace(/[\\r\\n]+/g, ' '), 64)}: ${short(message.replace(/[\\r\\n]+/g, ' '), 180)}`; try { notifier.notify({ title, message: body, sound: true, wait: false, appID: 'WA CMD' }, (err: unknown) => { if (err) console.error(chalk.gray(`Notification error: ${err instanceof Error ? err.message : String(err)}`)); }); } catch (err) { console.error(chalk.gray(`Notification error: ${err instanceof Error ? err.message : String(err)}`)); } }";

if (!src.includes('notifier.notify({ title, message: body')) {
  const start = src.indexOf('function terminalBell(): void');
  const end = src.indexOf('function openMedia(', start);
  if (start === -1 || end === -1 || end <= start) {
    console.warn('Notification functions tidak ketemu; skip replacement karena source mungkin sudah beda.');
  } else {
    src = `${src.slice(0, start)}${newNotifierNotify}\n${src.slice(end)}`;
    changed = true;
  }
}

if (src.includes("import { spawn } from 'node:child_process';") && !src.includes('spawn(')) {
  src = src.replace(/import \{ spawn \} from 'node:child_process';\r?\n/, '');
  changed = true;
}

if (changed) {
  fs.writeFileSync(file, src);
  console.log('patched: app notification now uses node-notifier like notify:test.');
} else {
  console.log('notification source already patched.');
}

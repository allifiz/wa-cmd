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

function replaceFirstAfter(label, after, needle, replacement) {
  const start = src.indexOf(after);
  const pos = start >= 0 ? src.indexOf(needle, start) : -1;
  if (pos === -1) return false;
  src = `${src.slice(0, pos)}${replacement}${src.slice(pos + needle.length)}`;
  changed = true;
  return true;
}

function replaceInPromptLoop(label, needle, replacement) {
  const start = src.indexOf('async function promptLoop');
  if (start === -1) return false;
  const pos = src.indexOf(needle, start);
  if (pos === -1) return false;
  src = `${src.slice(0, pos)}${replacement}${src.slice(pos + needle.length)}`;
  changed = true;
  return true;
}

patch(
  'quote snapshot state',
  "let pendingQuote: StoredMessage | null = null;",
  "let pendingQuote: StoredMessage | null = null;\ntype QuoteInputSnapshot = { chat: string; index: number; message: StoredMessage };\nlet quoteInputSnapshot: QuoteInputSnapshot | null = null;",
  'type QuoteInputSnapshot = { chat: string; index: number; message: StoredMessage };'
);

const helpers = "function quoteIndexError(): Error { return new Error('Format: q <no> <pesan>. Nomor harus dari pesan yang terlihat di room chat.'); }\nfunction quoteIndexFromPromptLine(line = promptState().line): number | null { const match = line.trim().match(/^(?:q|qr|reply|\\/reply|\\/quote)\\s+(\\d+)(?:\\s|$)/i); if (!match) return null; const index = Number(match[1]); return Number.isInteger(index) && index >= 1 ? index : null; }\nfunction captureQuoteInputSnapshotBeforeRender(): void { if (mode !== 'chat' || !currentChat || !promptActive || !promptHasInput()) { quoteInputSnapshot = null; return; } const index = quoteIndexFromPromptLine(); if (!index) { quoteInputSnapshot = null; return; } const chat = rootJid(currentChat); if (quoteInputSnapshot?.chat === chat && quoteInputSnapshot.index === index) return; const message = activeChatMessages[index - 1]; if (message) quoteInputSnapshot = { chat, index, message }; }\nfunction snapshotQuoteMessage(index: number): StoredMessage | null { if (!quoteInputSnapshot || !currentChat) return null; if (quoteInputSnapshot.chat !== rootJid(currentChat) || quoteInputSnapshot.index !== index) return null; return quoteInputSnapshot.message; }\nfunction quoteInputSnapshotLabel(): string | null { if (!quoteInputSnapshot || !currentChat || quoteInputSnapshot.chat !== rootJid(currentChat)) return null; const m = quoteInputSnapshot.message; const who = m.fromMe ? 'kamu' : (m.senderName || 'dia'); return `Quote lock [${String(quoteInputSnapshot.index).padStart(2, '0')}] → ${who}: ${short(m.text.replace(/[\\r\\n]+/g, ' '), 72)}`; }\nfunction clearQuoteInputSnapshot(): void { quoteInputSnapshot = null; }";

if (src.includes('function quoteInputSnapshotLabel(): string | null')) {
  // already has helper
} else if (src.includes('function captureQuoteInputSnapshotBeforeRender(): void')) {
  const start = src.indexOf('function quoteIndexError(): Error');
  const end = src.indexOf('function unquoteableViewOnceError(): Error', start);
  if (start === -1 || end === -1 || end <= start) {
    console.error('Target patch tidak ketemu: replace quote snapshot helpers');
    process.exit(1);
  }
  src = `${src.slice(0, start)}${helpers}\n${src.slice(end)}`;
  changed = true;
} else {
  patch('quote snapshot helpers', "function quoteIndexError(): Error { return new Error('Format: q <no> <pesan>. Nomor harus dari pesan yang terlihat di room chat.'); }", helpers, 'function captureQuoteInputSnapshotBeforeRender(): void');
}

patch(
  'resolve quote from snapshot',
  "const msg = activeChatMessages[index - 1]; if (!msg?.quote) {",
  "const msg = snapshotQuoteMessage(index) ?? activeChatMessages[index - 1]; if (!msg?.quote) {",
  'snapshotQuoteMessage(index) ?? activeChatMessages[index - 1]'
);

if (src.includes('captureQuoteInputSnapshotBeforeRender(); renderPending = false;')) {
  // already patched
} else if (src.includes('function render(): void { const state = promptActive && promptHasInput() ? promptState() : undefined; renderPending = false;')) {
  src = src.replace('function render(): void { const state = promptActive && promptHasInput() ? promptState() : undefined; renderPending = false;', 'function render(): void { const state = promptActive && promptHasInput() ? promptState() : undefined; captureQuoteInputSnapshotBeforeRender(); renderPending = false;');
  changed = true;
} else if (src.includes('function render(): void { renderPending = false;')) {
  src = src.replace('function render(): void { renderPending = false;', 'function render(): void { captureQuoteInputSnapshotBeforeRender(); renderPending = false;');
  changed = true;
} else if (src.includes('function render(): void { lastRender = Date.now();')) {
  src = src.replace('function render(): void { lastRender = Date.now();', 'function render(): void { captureQuoteInputSnapshotBeforeRender(); lastRender = Date.now();');
  changed = true;
} else {
  console.error('Target patch tidak ketemu: render wrapper quote snapshot');
  process.exit(1);
}

if (!src.includes('quoteInputSnapshotLabel(); if (quoteLock)')) {
  const inserted = replaceFirstAfter(
    'quote lock render indicator',
    'function renderChat',
    "console.log(chalk.gray(uiLine('pesan')));",
    "const quoteLock = quoteInputSnapshotLabel(); if (quoteLock) console.log(chalk.yellow(quoteLock)); console.log(chalk.gray(uiLine('pesan')));"
  );
  if (!inserted) console.warn('Quote lock indicator tidak disisipkan, tapi snapshot quote tetap aktif.');
}

if (src.includes('clearQuoteInputSnapshot(); flushPendingRender(); continue;') || src.includes('clearQuoteInputSnapshot(); render(); continue;')) {
  // already patched
} else if (src.includes('if (!line) { flushPendingRender(); continue; }')) {
  src = src.replace('if (!line) { flushPendingRender(); continue; }', 'if (!line) { clearQuoteInputSnapshot(); flushPendingRender(); continue; }');
  changed = true;
} else if (src.includes('if (!line) { render(); continue; }')) {
  src = src.replace('if (!line) { render(); continue; }', 'if (!line) { clearQuoteInputSnapshot(); render(); continue; }');
  changed = true;
} else {
  console.warn('Prompt loop empty-line clear tidak ketemu; lanjut tanpa stop.');
}

const catchLine = '} catch (e) { console.log(chalk.red(`Error: ${e instanceof Error ? e.message : String(e)}`)); }';
if (src.includes('clearQuoteInputSnapshot(); flushPendingRender(); } }') || src.includes('clearQuoteInputSnapshot(); render(); } }')) {
  // already patched
} else if (replaceInPromptLoop('prompt loop post command clear', `${catchLine} flushPendingRender();`, `${catchLine} clearQuoteInputSnapshot(); flushPendingRender();`)) {
  // patched
} else if (replaceInPromptLoop('prompt loop post command clear', `${catchLine} render();`, `${catchLine} clearQuoteInputSnapshot(); render();`)) {
  // patched
} else {
  console.warn('Prompt loop post-command clear tidak ketemu; lanjut tanpa stop.');
}

if (changed) {
  fs.writeFileSync(file, src);
  console.log('patched: quote indexes stay stable and show a quote lock indicator.');
} else {
  console.log('quote snapshot already patched.');
}

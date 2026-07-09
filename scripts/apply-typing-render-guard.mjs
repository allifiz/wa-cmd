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
  'add prompt render state',
  "let lastRender = 0;\nlet lastNotificationAt = 0;",
  "let lastRender = 0;\nlet promptActive = false;\nlet renderPending = false;\nlet lastNotificationAt = 0;",
  'let promptActive = false;\nlet renderPending = false;'
);

patch(
  'guard render while typing',
  "function render(): void { lastRender = Date.now(); mode === 'chat' ? renderChat() : renderList(); }",
  "function render(): void { if (promptActive) { renderPending = true; return; } renderPending = false; lastRender = Date.now(); mode === 'chat' ? renderChat() : renderList(); }\nfunction flushPendingRender(): void { if (!renderPending) return; renderPending = false; render(); }",
  'function flushPendingRender(): void'
);

patch(
  'prompt loop render flush',
  "async function promptLoop(sock: ReturnType<typeof makeWASocket>): Promise<void> { render(); while (true) { const label = mode === 'chat' && currentChat ? `${nameOf(currentChat)}${pendingQuote ? ' ↪' : ''}> ` : 'wa-cmd> '; const line = (await rl.question(chalk.green(label))).trim(); if (!line) continue; try { line.startsWith('/') ? await slash(sock, line) : await shortcut(sock, line); } catch (e) { console.log(chalk.red(`Error: ${e instanceof Error ? e.message : String(e)}`)); } } }",
  "async function promptLoop(sock: ReturnType<typeof makeWASocket>): Promise<void> { render(); while (true) { const label = mode === 'chat' && currentChat ? `${nameOf(currentChat)}${pendingQuote ? ' ↪' : ''}> ` : 'wa-cmd> '; promptActive = true; const line = (await rl.question(chalk.green(label))).trim(); promptActive = false; if (!line) { flushPendingRender(); continue; } try { line.startsWith('/') ? await slash(sock, line) : await shortcut(sock, line); } catch (e) { console.log(chalk.red(`Error: ${e instanceof Error ? e.message : String(e)}`)); } flushPendingRender(); } }",
  'promptActive = true; const line = (await rl.question'
);

if (changed) {
  fs.writeFileSync(file, src);
  console.log('patched: render is deferred while typing.');
} else {
  console.log('typing render guard already patched.');
}

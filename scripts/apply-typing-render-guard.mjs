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

if (!src.includes("import * as readlineCore from 'node:readline';")) {
  patch(
    'add readline core import',
    "import * as readline from 'node:readline/promises';\n",
    "import * as readline from 'node:readline/promises';\nimport * as readlineCore from 'node:readline';\n",
    "import * as readlineCore from 'node:readline';"
  );
}

patch(
  'add prompt render state',
  "let lastRender = 0;\nlet lastNotificationAt = 0;",
  "let lastRender = 0;\nlet promptActive = false;\nlet renderPending = false;\nlet lastNotificationAt = 0;",
  'let promptActive = false;\nlet renderPending = false;'
);

const liveRender = "type PromptState = { line: string; cursor: number };\nfunction promptLabel(): string { return mode === 'chat' && currentChat ? `${nameOf(currentChat)}${pendingQuote ? ' ↪' : ''}> ` : 'wa-cmd> '; }\nfunction promptState(): PromptState { const state = rl as unknown as { line?: string; cursor?: number }; const line = state.line ?? ''; return { line, cursor: state.cursor ?? line.length }; }\nfunction promptHasInput(): boolean { return Boolean(promptState().line.length); }\nfunction restorePromptInput(state?: PromptState): void { const label = promptLabel(); process.stdout.write(chalk.green(label)); if (!state) return; process.stdout.write(state.line); readlineCore.cursorTo(process.stdout, label.length + state.cursor); }\nfunction render(): void { const state = promptActive && promptHasInput() ? promptState() : undefined; renderPending = false; lastRender = Date.now(); mode === 'chat' ? renderChat() : renderList(); if (promptActive) restorePromptInput(state); }\nfunction flushPendingRender(): void { if (!renderPending) return; renderPending = false; render(); }";

const renderVariants = [
  "function render(): void { lastRender = Date.now(); mode === 'chat' ? renderChat() : renderList(); }",
  "function render(): void { if (promptActive) { renderPending = true; return; } renderPending = false; lastRender = Date.now(); mode === 'chat' ? renderChat() : renderList(); }\nfunction flushPendingRender(): void { if (!renderPending) return; renderPending = false; render(); }",
  "function promptLabel(): string { return mode === 'chat' && currentChat ? `${nameOf(currentChat)}${pendingQuote ? ' ↪' : ''}> ` : 'wa-cmd> '; }\nfunction promptHasInput(): boolean { return Boolean((rl as unknown as { line?: string }).line?.length); }\nfunction render(): void { if (promptActive && promptHasInput()) { renderPending = true; return; } renderPending = false; lastRender = Date.now(); mode === 'chat' ? renderChat() : renderList(); if (promptActive) process.stdout.write(chalk.green(promptLabel())); }\nfunction flushPendingRender(): void { if (!renderPending) return; renderPending = false; render(); }",
  "function promptLabel(): string { return mode === 'chat' && currentChat ? `${nameOf(currentChat)}${pendingQuote ? ' ↪' : ''}> ` : 'wa-cmd> '; }\nfunction promptHasInput(): boolean { return Boolean((rl as unknown as { line?: string }).line?.length); }\nfunction render(): void { if (promptActive && promptHasInput()) { renderPending = true; return; } renderPending = false; lastRender = Date.now(); mode === 'chat' ? renderChat() : renderList(); if (promptActive) process.stdout.write(chalk.green(promptLabel())); }\nfunction flushPendingRender(): void { if (!renderPending) return; renderPending = false; render(); }"
];

if (!src.includes('function restorePromptInput(')) {
  const variant = renderVariants.find((v) => src.includes(v));
  if (!variant) {
    console.error('Target patch tidak ketemu: live render functions');
    process.exit(1);
  }
  src = src.replace(variant, liveRender);
  changed = true;
}

const oldPromptLoop = "async function promptLoop(sock: ReturnType<typeof makeWASocket>): Promise<void> { render(); while (true) { const label = mode === 'chat' && currentChat ? `${nameOf(currentChat)}${pendingQuote ? ' ↪' : ''}> ` : 'wa-cmd> '; const line = (await rl.question(chalk.green(label))).trim(); if (!line) continue; try { line.startsWith('/') ? await slash(sock, line) : await shortcut(sock, line); } catch (e) { console.log(chalk.red(`Error: ${e instanceof Error ? e.message : String(e)}`)); } } }";
const guardedPromptLoop = "async function promptLoop(sock: ReturnType<typeof makeWASocket>): Promise<void> { render(); while (true) { promptActive = true; const line = (await rl.question(chalk.green(promptLabel()))).trim(); promptActive = false; if (!line) { flushPendingRender(); continue; } try { line.startsWith('/') ? await slash(sock, line) : await shortcut(sock, line); } catch (e) { console.log(chalk.red(`Error: ${e instanceof Error ? e.message : String(e)}`)); } flushPendingRender(); } }";
const oldGuardedPromptLoop = "async function promptLoop(sock: ReturnType<typeof makeWASocket>): Promise<void> { render(); while (true) { const label = mode === 'chat' && currentChat ? `${nameOf(currentChat)}${pendingQuote ? ' ↪' : ''}> ` : 'wa-cmd> '; promptActive = true; const line = (await rl.question(chalk.green(label))).trim(); promptActive = false; if (!line) { flushPendingRender(); continue; } try { line.startsWith('/') ? await slash(sock, line) : await shortcut(sock, line); } catch (e) { console.log(chalk.red(`Error: ${e instanceof Error ? e.message : String(e)}`)); } flushPendingRender(); } }";

if (src.includes(oldGuardedPromptLoop)) {
  src = src.replace(oldGuardedPromptLoop, guardedPromptLoop);
  changed = true;
} else if (!src.includes('await rl.question(chalk.green(promptLabel()))')) {
  patch('prompt loop render flush', oldPromptLoop, guardedPromptLoop, 'await rl.question(chalk.green(promptLabel()))');
}

if (changed) {
  fs.writeFileSync(file, src);
  console.log('patched: live refresh preserves the prompt input line.');
} else {
  console.log('typing render guard already patched.');
}

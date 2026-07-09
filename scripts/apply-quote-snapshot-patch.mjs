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
  'quote snapshot state',
  "let pendingQuote: StoredMessage | null = null;",
  "let pendingQuote: StoredMessage | null = null;\ntype QuoteInputSnapshot = { chat: string; index: number; message: StoredMessage };\nlet quoteInputSnapshot: QuoteInputSnapshot | null = null;",
  'type QuoteInputSnapshot = { chat: string; index: number; message: StoredMessage };'
);

patch(
  'quote snapshot helpers',
  "function quoteIndexError(): Error { return new Error('Format: q <no> <pesan>. Nomor harus dari pesan yang terlihat di room chat.'); }",
  "function quoteIndexError(): Error { return new Error('Format: q <no> <pesan>. Nomor harus dari pesan yang terlihat di room chat.'); }\nfunction quoteIndexFromPromptLine(line = promptState().line): number | null { const match = line.trim().match(/^(?:q|qr|reply|\\/reply|\\/quote)\\s+(\\d+)(?:\\s|$)/i); if (!match) return null; const index = Number(match[1]); return Number.isInteger(index) && index >= 1 ? index : null; }\nfunction captureQuoteInputSnapshotBeforeRender(): void { if (mode !== 'chat' || !currentChat || !promptActive || !promptHasInput()) { quoteInputSnapshot = null; return; } const index = quoteIndexFromPromptLine(); if (!index) { quoteInputSnapshot = null; return; } const chat = rootJid(currentChat); if (quoteInputSnapshot?.chat === chat && quoteInputSnapshot.index === index) return; const message = activeChatMessages[index - 1]; if (message) quoteInputSnapshot = { chat, index, message }; }\nfunction snapshotQuoteMessage(index: number): StoredMessage | null { if (!quoteInputSnapshot || !currentChat) return null; if (quoteInputSnapshot.chat !== rootJid(currentChat) || quoteInputSnapshot.index !== index) return null; return quoteInputSnapshot.message; }\nfunction clearQuoteInputSnapshot(): void { quoteInputSnapshot = null; }",
  'function captureQuoteInputSnapshotBeforeRender(): void'
);

patch(
  'resolve quote from snapshot',
  "const msg = activeChatMessages[index - 1]; if (!msg?.quote) {",
  "const msg = snapshotQuoteMessage(index) ?? activeChatMessages[index - 1]; if (!msg?.quote) {",
  'snapshotQuoteMessage(index) ?? activeChatMessages[index - 1]'
);

if (src.includes('captureQuoteInputSnapshotBeforeRender(); activeChatMessages = list;')) {
  // already patched
} else if (src.includes('const list = allMessages.slice(-CHAT_VIEW_LIMIT); activeChatMessages = list;')) {
  src = src.replace('const list = allMessages.slice(-CHAT_VIEW_LIMIT); activeChatMessages = list;', 'const list = allMessages.slice(-CHAT_VIEW_LIMIT); captureQuoteInputSnapshotBeforeRender(); activeChatMessages = list;');
  changed = true;
} else {
  console.error('Target patch tidak ketemu: render chat active messages assignment');
  process.exit(1);
}

if (src.includes('clearQuoteInputSnapshot(); flushPendingRender(); continue;')) {
  // already patched
} else if (src.includes('if (!line) { flushPendingRender(); continue; }')) {
  src = src.replace('if (!line) { flushPendingRender(); continue; }', 'if (!line) { clearQuoteInputSnapshot(); flushPendingRender(); continue; }');
  changed = true;
} else {
  console.error('Target patch tidak ketemu: prompt loop empty line clear');
  process.exit(1);
}

if (src.includes('clearQuoteInputSnapshot(); flushPendingRender(); } }')) {
  // already patched
} else if (src.includes('} catch (e) { console.log(chalk.red(`Error: ${e instanceof Error ? e.message : String(e)}`)); } flushPendingRender(); } }')) {
  src = src.replace('} catch (e) { console.log(chalk.red(`Error: ${e instanceof Error ? e.message : String(e)}`)); } flushPendingRender(); } }', '} catch (e) { console.log(chalk.red(`Error: ${e instanceof Error ? e.message : String(e)}`)); } clearQuoteInputSnapshot(); flushPendingRender(); } }');
  changed = true;
} else {
  console.error('Target patch tidak ketemu: prompt loop post command clear');
  process.exit(1);
}

if (changed) {
  fs.writeFileSync(file, src);
  console.log('patched: quote indexes stay stable while typing through live refreshes.');
} else {
  console.log('quote snapshot already patched.');
}

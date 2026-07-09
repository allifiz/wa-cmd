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

patch('chat render limit constant', (s) => {
  if (s.includes('const CHAT_VIEW_LIMIT = 10;')) return s;
  return s.replace('const MAX_MSG = 80;', 'const MAX_MSG = 80;\nconst CHAT_VIEW_LIMIT = 10;');
});

patch('limit chat view to last 10', (s) => {
  let out = s.replace(
    'const list = dedupeMessageList(messages.get(currentChat) ?? []).slice(-30);',
    'const allMessages = dedupeMessageList(messages.get(currentChat) ?? []);\n  const hiddenCount = Math.max(0, allMessages.length - CHAT_VIEW_LIMIT);\n  const list = allMessages.slice(-CHAT_VIEW_LIMIT);'
  );
  if (!out.includes('pesan lama disembunyikan')) {
    out = out.replace(
      "if (!list.length) console.log(chalk.gray('Belum ada pesan lokal untuk chat ini.'));",
      "if (hiddenCount) console.log(chalk.gray(`↑ ${hiddenCount} pesan lama disembunyikan. Tampilan hanya ${CHAT_VIEW_LIMIT} pesan terakhir.`));\n  if (!list.length) console.log(chalk.gray('Belum ada pesan lokal untuk chat ini.'));"
    );
  }
  return out;
});

if (changed) fs.writeFileSync(file, src);

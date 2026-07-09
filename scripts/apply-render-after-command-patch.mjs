#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), 'src', 'index.ts');
let src = fs.readFileSync(file, 'utf8');
let changed = false;

const badWithQuoteClear = "} catch (e) { console.log(chalk.red(`Error: ${e instanceof Error ? e.message : String(e)}`)); } clearQuoteInputSnapshot(); render(); } }";
const goodWithQuoteClear = "} catch (e) { console.log(chalk.red(`Error: ${e instanceof Error ? e.message : String(e)}`)); } clearQuoteInputSnapshot(); flushPendingRender(); } }";

const badPlain = "} catch (e) { console.log(chalk.red(`Error: ${e instanceof Error ? e.message : String(e)}`)); } render(); } }";
const goodPlain = "} catch (e) { console.log(chalk.red(`Error: ${e instanceof Error ? e.message : String(e)}`)); } flushPendingRender(); } }";

if (src.includes(badWithQuoteClear)) {
  src = src.replace(badWithQuoteClear, goodWithQuoteClear);
  changed = true;
} else if (src.includes(badPlain)) {
  src = src.replace(badPlain, goodPlain);
  changed = true;
}

function injectRenderAfter(label, marker) {
  if (!src.includes(marker)) {
    console.warn(`${label} marker tidak ketemu; lanjut tanpa stop.`);
    return;
  }
  const replacement = marker.includes('render();') ? marker : `${marker} render();`;
  if (src.includes(replacement)) return;
  src = src.replace(marker, replacement);
  changed = true;
}

injectRenderAfter(
  'sendText render after sent',
  "saveData(); console.log(chalk.green('sent ✓'));"
);

injectRenderAfter(
  'sendQuotedText render after sent',
  "saveData(); console.log(chalk.green('quoted reply sent ✓'));"
);

if (changed) {
  fs.writeFileSync(file, src);
  console.log('patched: chat redraws after sending only, commands keep their output.');
} else {
  console.log('render after send already patched.');
}

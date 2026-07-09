#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), 'src', 'index.ts');
let src = fs.readFileSync(file, 'utf8');
let changed = false;

const oldWithQuoteClear = "} catch (e) { console.log(chalk.red(`Error: ${e instanceof Error ? e.message : String(e)}`)); } clearQuoteInputSnapshot(); flushPendingRender(); } }";
const newWithQuoteClear = "} catch (e) { console.log(chalk.red(`Error: ${e instanceof Error ? e.message : String(e)}`)); } clearQuoteInputSnapshot(); render(); } }";

const oldPlain = "} catch (e) { console.log(chalk.red(`Error: ${e instanceof Error ? e.message : String(e)}`)); } flushPendingRender(); } }";
const newPlain = "} catch (e) { console.log(chalk.red(`Error: ${e instanceof Error ? e.message : String(e)}`)); } render(); } }";

if (src.includes(newWithQuoteClear) || src.includes(newPlain)) {
  console.log('render after command already patched.');
} else if (src.includes(oldWithQuoteClear)) {
  src = src.replace(oldWithQuoteClear, newWithQuoteClear);
  changed = true;
} else if (src.includes(oldPlain)) {
  src = src.replace(oldPlain, newPlain);
  changed = true;
} else {
  console.error('Target patch tidak ketemu: render after command prompt loop');
  process.exit(1);
}

if (changed) {
  fs.writeFileSync(file, src);
  console.log('patched: chat redraws after sending a message or command.');
}

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

patch('view-once chat marker helper', (s) => {
  const marker = '\nasync function saveIncomingImage(sock: ReturnType<typeof makeWASocket>, rawMessage: any, jid: string, fromMe: boolean, senderName: string, at: number): Promise<MediaSaveResult | null> {';
  const idx = s.indexOf(marker);
  if (idx === -1) return s;

  const block = [
    'function payloadLooksViewOnce(value: unknown, depth = 0, seen = new WeakSet<object>()): boolean {',
    '  if (!value || depth > 8) return false;',
    "  if (typeof value === 'string') return /view.?once/i.test(value);",
    "  if (typeof value === 'number' || typeof value === 'boolean') return false;",
    "  if (typeof value !== 'object') return false;",
    '  if (seen.has(value)) return false;',
    '  seen.add(value);',
    '  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {',
    "    if (/viewOnce|view_once|view-once/i.test(key)) return true;",
    "    if ((key === 'messageStubType' || key === 'type') && /view.?once/i.test(String(child))) return true;",
    '    if (payloadLooksViewOnce(child, depth + 1, seen)) return true;',
    '  }',
    '  return false;',
    '}',
    'function viewOnceChatMarker(rawMessage?: unknown, senderName = \'user\', fromMe = false, item?: MediaItem, mediaText?: string): string | null {',
    "  const raw = rawMessage as any;",
    "  const message = raw?.message ?? raw;",
    "  const mediaLooksViewOnce = Boolean(mediaText && /view-once/i.test(mediaText));",
    "  const directLooksViewOnce = isViewOnce(message) || payloadLooksViewOnce(raw);",
    "  if (item?.kind !== 'view-once-image' && !mediaLooksViewOnce && !directLooksViewOnce) return null;",
    "  const who = fromMe ? 'kamu' : (senderName.trim() || 'user');",
    "  const id = item?.kind === 'view-once-image' ? ' #v' + item.id : '';",
    "  return '[' + who + ' kirim view-once' + id + ']';",
    '}',
    '',
  ].join('\n');

  const existingStart = s.indexOf('function payloadLooksViewOnce(') !== -1
    ? s.indexOf('function payloadLooksViewOnce(')
    : s.indexOf('function viewOnceChatMarker(');
  if (existingStart !== -1) {
    const existingEnd = s.indexOf('\nasync function saveIncomingImage', existingStart);
    if (existingEnd === -1) return s;
    return `${s.slice(0, existingStart)}${block}${s.slice(existingEnd)}`;
  }

  return `${s.slice(0, idx)}\n${block}${s.slice(idx)}`;
});

patch('prefer view-once marker in chat text', (s) => {
  let out = s.replace(
    'const text = mediaResult?.text ?? textOf(m.message);',
    'const text = viewOnceChatMarker(m as any, senderName, fromMe, mediaResult?.item, mediaResult?.text) ?? mediaResult?.text ?? textOf(m.message);'
  );
  out = out.replace(
    'const text = viewOnceChatMarker(m.message, senderName, fromMe, mediaResult?.item) ?? mediaResult?.text ?? textOf(m.message);',
    'const text = viewOnceChatMarker(m as any, senderName, fromMe, mediaResult?.item, mediaResult?.text) ?? mediaResult?.text ?? textOf(m.message);'
  );
  out = out.replace(
    'const text = viewOnceChatMarker(m as any, senderName, fromMe, mediaResult?.item, mediaResult?.text) ?? mediaResult?.text ?? textOf(m.message);',
    'const text = viewOnceChatMarker(m as any, senderName, fromMe, mediaResult?.item, mediaResult?.text) ?? mediaResult?.text ?? textOf(m.message);'
  );
  return out;
});

if (changed) fs.writeFileSync(file, src);

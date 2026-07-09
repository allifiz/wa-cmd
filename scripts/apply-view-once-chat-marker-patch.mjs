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
  if (s.includes('function viewOnceChatMarker(')) return s;
  const marker = '\nasync function saveIncomingImage(sock: ReturnType<typeof makeWASocket>, rawMessage: any, jid: string, fromMe: boolean, senderName: string, at: number): Promise<MediaSaveResult | null> {';
  const idx = s.indexOf(marker);
  if (idx === -1) return s;
  const block = `
function viewOnceChatMarker(raw?: proto.IMessage | null, senderName = 'user', fromMe = false, item?: MediaItem): string | null {
  if (item?.kind !== 'view-once-image' && !isViewOnce(raw)) return null;
  const who = fromMe ? 'kamu' : (senderName.trim() || 'user');
  const id = item?.kind === 'view-once-image' ? ` + "` #v${item.id}`" + ` : '';
  return `[${who} kirim view-once${id}]`;
}
`;
  return `${s.slice(0, idx)}${block}${s.slice(idx)}`;
});

patch('prefer view-once marker in chat text', (s) => {
  return s.replace(
    'const text = mediaResult?.text ?? textOf(m.message);',
    'const text = viewOnceChatMarker(m.message, senderName, fromMe, mediaResult?.item) ?? mediaResult?.text ?? textOf(m.message);'
  );
});

if (changed) fs.writeFileSync(file, src);

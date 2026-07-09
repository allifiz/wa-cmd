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
  'stored message status type',
  "type StoredMessage = { jid: string; fromMe: boolean; senderName: string; text: string; at: number; seenAt?: number; censoredAt?: number; quote?: any };",
  "type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'played' | 'failed';\ntype StoredMessage = { jid: string; id?: string; fromMe: boolean; senderName: string; text: string; at: number; seenAt?: number; censoredAt?: number; quote?: any; status?: MessageStatus; receiptAt?: number };",
  "type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'played' | 'failed';"
);

const statusHelpers = "const MESSAGE_STATUS_RANK: Record<MessageStatus, number> = { failed: 0, pending: 1, sent: 2, delivered: 3, read: 4, played: 5 };\nfunction messageStatusFromValue(value: unknown): MessageStatus | undefined { if (typeof value === 'number') { if (value <= 0) return 'failed'; if (value === 1) return 'pending'; if (value === 2) return 'sent'; if (value === 3) return 'delivered'; if (value === 4) return 'read'; if (value >= 5) return 'played'; } if (typeof value !== 'string') return undefined; const s = value.toLowerCase(); if (s === 'played' || s === 'played_ack') return 'played'; if (s === 'read' || s === 'read_ack') return 'read'; if (s === 'delivery' || s === 'delivered' || s === 'delivery_ack') return 'delivered'; if (s === 'server_ack' || s === 'server' || s === 'sent') return 'sent'; if (s === 'pending' || s === 'clock') return 'pending'; if (s === 'error' || s === 'failed' || s === 'fail') return 'failed'; return undefined; }\nfunction betterMessageStatus(oldStatus: MessageStatus | undefined, nextStatus: MessageStatus | undefined): MessageStatus | undefined { if (!nextStatus) return oldStatus; if (!oldStatus) return nextStatus; return MESSAGE_STATUS_RANK[nextStatus] >= MESSAGE_STATUS_RANK[oldStatus] ? nextStatus : oldStatus; }\nfunction messageStatusFromReceipt(raw: any): MessageStatus | undefined { return messageStatusFromValue(raw?.update?.status) ?? messageStatusFromValue(raw?.status) ?? messageStatusFromValue(raw?.receipt?.type) ?? messageStatusFromValue(raw?.type); }\nfunction messageIdFromRaw(raw: any): string | undefined { return raw?.key?.id ?? raw?.id ?? undefined; }\nfunction outgoingInitialStatus(_raw: any): MessageStatus { return 'sent'; }\nfunction messageStatusIcon(m: StoredMessage): string { if (!m.fromMe) return ''; const status = m.status ?? 'sent'; if (status === 'played' || status === 'read') return chalk.blue('✓✓'); if (status === 'delivered') return chalk.gray('✓✓'); if (status === 'sent') return chalk.gray('✓'); if (status === 'pending') return chalk.gray('…'); if (status === 'failed') return chalk.red('!'); return ''; }\nfunction updateOutgoingMessageStatus(rawJid: string | undefined, messageId: string | undefined, status: MessageStatus | undefined): boolean { if (!messageId || !status) return false; const candidates = rawJid ? [rootJid(jidNormalizedUser(rawJid) ?? rawJid)] : [...messages.keys()]; for (const jid of candidates) { const list = messages.get(jid); if (!list) continue; const msg = list.find((m) => m.fromMe && m.id === messageId); if (!msg) continue; const next = betterMessageStatus(msg.status, status); if (next === msg.status) return false; msg.status = next; msg.receiptAt = Date.now(); return true; } return false; }\nfunction applyMessageStatusUpdate(raw: any): boolean { const key = raw?.key ?? raw?.message?.key ?? raw?.messageInfo?.key ?? {}; const jid = key.remoteJid ?? raw?.remoteJid ?? raw?.jid; const id = key.id ?? raw?.id ?? raw?.messageId ?? raw?.message?.key?.id; const status = messageStatusFromReceipt(raw); return updateOutgoingMessageStatus(jid, id, status); }\nfunction handleMessageStatusUpdates(updates: any): void { const list = Array.isArray(updates) ? updates : [updates]; let changed = false; for (const item of list) if (applyMessageStatusUpdate(item)) changed = true; if (changed) { saveData(); render(); } }";

if (src.includes('const MESSAGE_STATUS_RANK: Record<MessageStatus, number>')) {
  const start = src.indexOf('const MESSAGE_STATUS_RANK: Record<MessageStatus, number>');
  const end = src.indexOf('function upsertContact', start);
  if (start === -1 || end === -1 || end <= start) {
    console.error('Target patch tidak ketemu: replace status helper block');
    process.exit(1);
  }
  src = `${src.slice(0, start)}${statusHelpers}\n${src.slice(end)}`;
  changed = true;
} else {
  patch(
    'message status helpers',
    "function getStickerMessage(raw?: proto.IMessage | null): boolean { return Boolean(unwrapMessage(raw)?.stickerMessage); }",
    `function getStickerMessage(raw?: proto.IMessage | null): boolean { return Boolean(unwrapMessage(raw)?.stickerMessage); }\n${statusHelpers}`,
    'function handleMessageStatusUpdates(updates: any): void'
  );
}

patch(
  'push message with id merge',
  "function pushMsg(m: StoredMessage): void { const jid = rootJid(m.jid); if (!m.text || m.text === '[unsupported message]') return; const fixed = { ...m, jid }; const list = messages.get(jid) ?? []; if (list.some((old) => isSameMessage(old, fixed))) return; list.push(fixed); messages.set(jid, list.slice(-MAX_MSG)); }",
  "function pushMsg(m: StoredMessage): void { const jid = rootJid(m.jid); if (!m.text || m.text === '[unsupported message]') return; const fixed = { ...m, jid }; const list = messages.get(jid) ?? []; if (fixed.id) { const existing = list.find((old) => old.id === fixed.id && old.fromMe === fixed.fromMe); if (existing) { Object.assign(existing, { ...fixed, status: betterMessageStatus(existing.status, fixed.status), receiptAt: fixed.receiptAt ?? existing.receiptAt }); messages.set(jid, list.slice(-MAX_MSG)); return; } } if (list.some((old) => isSameMessage(old, fixed))) return; list.push(fixed); messages.set(jid, list.slice(-MAX_MSG)); }",
  'betterMessageStatus(existing.status, fixed.status)'
);

patch(
  'render outgoing message status icon',
  "if (preview) console.log(chalk.gray(`    ↪ ${preview}`)); console.log(`${chalk.cyan(`[${i + 1}]`)} ${chalk.gray(time(m.at))} ${m.fromMe ? chalk.green('kamu') : chalk.magenta(m.senderName || 'dia')}: ${m.censoredAt ? chalk.gray(m.text) : m.text}`);",
  "if (preview) console.log(chalk.gray(`    ↪ ${preview}`)); const status = messageStatusIcon(m); console.log(`${chalk.cyan(`[${i + 1}]`)} ${chalk.gray(time(m.at))} ${status ? `${status} ` : ''}${m.fromMe ? chalk.green('kamu') : chalk.magenta(m.senderName || 'dia')}: ${m.censoredAt ? chalk.gray(m.text) : m.text}`);",
  'const status = messageStatusIcon(m);'
);

patch(
  'send text status metadata',
  "pushMsg({ jid, fromMe: true, senderName: 'kamu', text, at, quote: quoteInfoFromRaw(sent as any, jid, text) ?? undefined });",
  "pushMsg({ jid, id: messageIdFromRaw(sent as any), fromMe: true, senderName: 'kamu', text, at, quote: quoteInfoFromRaw(sent as any, jid, text) ?? undefined, status: outgoingInitialStatus(sent as any) });",
  'status: outgoingInitialStatus(sent as any)'
);

patch(
  'quoted send text status metadata',
  "pushMsg({ jid, fromMe: true, senderName: 'kamu', text: clean, at, quote: quoteInfoFromRaw(sent as any, jid, clean) ?? undefined });",
  "pushMsg({ jid, id: messageIdFromRaw(sent as any), fromMe: true, senderName: 'kamu', text: clean, at, quote: quoteInfoFromRaw(sent as any, jid, clean) ?? undefined, status: outgoingInitialStatus(sent as any) });",
  "text: clean, at, quote: quoteInfoFromRaw(sent as any, jid, clean) ?? undefined, status: outgoingInitialStatus(sent as any)"
);

patch(
  'incoming echo status metadata',
  "pushMsg({ jid, fromMe, senderName, text, at, quote: quoteInfoFromRaw(m as any, jid, text) ?? undefined });",
  "pushMsg({ jid, id: m.key.id ?? undefined, fromMe, senderName, text, at, quote: quoteInfoFromRaw(m as any, jid, text) ?? undefined, status: fromMe ? (messageStatusFromValue((m as any).status) ?? 'sent') : undefined });",
  "id: m.key.id ?? undefined, fromMe, senderName, text, at"
);

patch(
  'message status event listeners',
  "saveData(); }); sock.ev.on('connection.update'",
  "saveData(); }); (sock.ev as any).on('messages.update', handleMessageStatusUpdates); (sock.ev as any).on('message-receipt.update', handleMessageStatusUpdates); sock.ev.on('connection.update'",
  "(sock.ev as any).on('messages.update', handleMessageStatusUpdates)"
);

if (changed) {
  fs.writeFileSync(file, src);
  console.log('patched: outgoing message status receipts are tracked with strict parsing.');
} else {
  console.log('message status patch already applied.');
}

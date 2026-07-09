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

patch('stored message quote payload', (s) => {
  if (s.includes('quote?: any')) return s;
  return s.replace(
    /type StoredMessage = \{([^}]*?) \};/,
    (match) => match.replace(' };', '; quote?: any };')
  );
});

patch('active quote message list', (s) => {
  if (s.includes('let activeChatMessages: StoredMessage[]')) return s;
  return s.replace(
    'let activeList: ListItem[] = [];',
    'let activeList: ListItem[] = [];\nlet activeChatMessages: StoredMessage[] = [];'
  );
});

patch('quote helpers', (s) => {
  const marker = '\nasync function sendText(sock: ReturnType<typeof makeWASocket>, jidRaw: string, text: string): Promise<void> {';
  const idx = s.indexOf(marker);
  if (idx === -1) return s;
  const block = `
function isViewOnceMarkerText(text?: string): boolean {
  return Boolean(text && /view-once/i.test(text));
}
function quoteInfoFromRaw(raw: any, fallbackJid: string, fallbackText?: string): any | null {
  const key = raw?.key;
  const rawMessage = raw?.message;
  const fallbackIsViewOnceMarker = isViewOnceMarkerText(fallbackText);
  const rawLooksLikeViewOnce = Boolean(rawMessage && (isViewOnce(rawMessage) || payloadLooksViewOnce(rawMessage)));

  // Penting: untuk view-once, jangan pernah bikin quote palsu berupa teks marker.
  // Kalau payload asli view-once ada, pakai payload itu. Kalau cuma placeholder, biarkan tidak quoteable.
  if (fallbackIsViewOnceMarker && !rawLooksLikeViewOnce) return null;

  const message = rawMessage ?? (fallbackText ? { conversation: fallbackText } : null);
  if (!key?.id || !message) return null;
  return {
    key: {
      remoteJid: rootJid(key.remoteJid ?? fallbackJid),
      fromMe: Boolean(key.fromMe),
      id: key.id,
      participant: key.participant,
    },
    message,
    messageTimestamp: raw?.messageTimestamp ?? Math.floor(Date.now() / 1000),
  };
}
function quoteIndexError(): Error {
  return new Error('Format: q <no> <pesan>. Nomor harus dari pesan yang terlihat di room chat.');
}
function unquoteableViewOnceError(): Error {
  return new Error('View-once ini cuma placeholder dari WhatsApp linked device, bukan payload media asli. CMD tidak bisa quote-reply untuk trigger simpan. Kalau marker berikutnya muncul dengan #v atau payload asli, baru bisa di-quote dari CMD; selain itu quote dari HP dulu.');
}
function resolveQuoteMessage(raw: string): StoredMessage {
  if (mode !== 'chat' || !currentChat) throw new Error('Quote reply hanya bisa dipakai di dalam room chat.');
  const index = Number(raw);
  if (!Number.isInteger(index) || index < 1 || index > activeChatMessages.length) throw quoteIndexError();
  const msg = activeChatMessages[index - 1];
  if (!msg?.quote) {
    if (isViewOnceMarkerText(msg?.text)) throw unquoteableViewOnceError();
    throw new Error('Pesan ini belum bisa di-quote. Coba quote pesan baru yang masuk setelah update fitur ini.');
  }
  return msg;
}
function resolveLastIncomingQuoteMessage(): StoredMessage {
  if (mode !== 'chat' || !currentChat) throw new Error('Quote reply hanya bisa dipakai di dalam room chat.');
  const msg = [...activeChatMessages].reverse().find((m) => !m.fromMe);
  if (!msg) throw new Error('Belum ada pesan lawan chat di tampilan ini.');
  if (!msg.quote) {
    if (isViewOnceMarkerText(msg.text)) throw unquoteableViewOnceError();
    throw new Error('Pesan terakhir dari lawan chat belum bisa di-quote. Pakai q <no> untuk pilih pesan lain yang quoteable.');
  }
  return msg;
}
async function sendQuotedText(sock: ReturnType<typeof makeWASocket>, jidRaw: string, quoted: StoredMessage, text: string): Promise<void> {
  const jid = rootJid(jidRaw);
  const clean = text.trim();
  if (!clean) throw new Error('Pesan kosong. Format: q <no> <pesan>');
  const sent = await sock.sendMessage(jid, { text: clean }, { quoted: quoted.quote } as any);
  const at = Date.now();
  upsertChat(jid, nameOf(jid), clean, true, at);
  pushMsg({ jid, fromMe: true, senderName: 'kamu', text: clean, at, quote: quoteInfoFromRaw(sent as any, jid, clean) ?? undefined });
  markChatRepliedForCensor(jid);
  saveData();
  console.log(chalk.green('quoted reply sent ✓'));
}
`;

  const existingStart = s.indexOf('function isViewOnceMarkerText(') !== -1
    ? s.indexOf('function isViewOnceMarkerText(')
    : s.indexOf('function quoteInfoFromRaw(');
  if (existingStart !== -1) {
    const existingEnd = s.indexOf(marker, existingStart);
    if (existingEnd === -1) return s;
    return `${s.slice(0, existingStart)}${block}${s.slice(existingEnd)}`;
  }

  return `${s.slice(0, idx)}${block}${s.slice(idx)}`;
});

patch('store outgoing quote payload', (s) => {
  let out = s;
  out = out.replace(
    'await sock.sendMessage(jid, content);',
    'const sent = await sock.sendMessage(jid, content);'
  );
  out = out.replace(
    "pushMsg({ jid, fromMe: true, senderName: 'kamu', text, at });",
    "pushMsg({ jid, fromMe: true, senderName: 'kamu', text, at, quote: quoteInfoFromRaw(sent as any, jid, text) ?? undefined });"
  );
  out = out.replace(
    "pushMsg({ jid, fromMe: true, senderName: 'kamu', text, at, quote: quoteInfoFromRaw(sent as any, jid) ?? undefined });",
    "pushMsg({ jid, fromMe: true, senderName: 'kamu', text, at, quote: quoteInfoFromRaw(sent as any, jid, text) ?? undefined });"
  );
  return out;
});

patch('store incoming quote payload', (s) => {
  let out = s.replace(
    'upsertChat(jid, chatName, text, fromMe, at);\n      pushMsg({ jid, fromMe, senderName, text, at });',
    'upsertChat(jid, chatName, text, fromMe, at);\n      pushMsg({ jid, fromMe, senderName, text, at, quote: quoteInfoFromRaw(m as any, jid, text) ?? undefined });'
  );
  out = out.replace(
    'upsertChat(jid, chatName, text, fromMe, at);\n      pushMsg({ jid, fromMe, senderName, text, at, quote: quoteInfoFromRaw(m as any, jid) ?? undefined });',
    'upsertChat(jid, chatName, text, fromMe, at);\n      pushMsg({ jid, fromMe, senderName, text, at, quote: quoteInfoFromRaw(m as any, jid, text) ?? undefined });'
  );
  return out;
});

patch('number visible chat messages', (s) => {
  let out = s;
  if (!out.includes('activeChatMessages = [];\n  activeList = listForMode();')) {
    out = out.replace(
      'activeList = listForMode();',
      'activeChatMessages = [];\n  activeList = listForMode();'
    );
  }
  out = out.replace(
    'for (const m of list) console.log(`${chalk.gray(time(m.at))} ${m.fromMe ? chalk.green(\'kamu\') : chalk.magenta(m.senderName || \'dia\')}: ${m.censoredAt ? chalk.gray(m.text) : m.text}`);',
    "activeChatMessages = list;\n  list.forEach((m, i) => console.log(`${chalk.cyan(`[${i + 1}]`)} ${chalk.gray(time(m.at))} ${m.fromMe ? chalk.green('kamu') : chalk.magenta(m.senderName || 'dia')}: ${m.censoredAt ? chalk.gray(m.text) : m.text}`));"
  );
  out = out.replace(
    'for (const m of list) console.log(`${chalk.gray(time(m.at))} ${m.fromMe ? chalk.green(\'kamu\') : chalk.magenta(m.senderName || \'dia\')}: ${m.text}`);',
    "activeChatMessages = list;\n  list.forEach((m, i) => console.log(`${chalk.cyan(`[${i + 1}]`)} ${chalk.gray(time(m.at))} ${m.fromMe ? chalk.green('kamu') : chalk.magenta(m.senderName || 'dia')}: ${m.text}`));"
  );
  return out;
});

patch('quote help text', (s) => {
  let out = s;
  out = out.replace(
    'r <no> <pesan> | v <media-id>',
    'r <no> <pesan> | q <no> <pesan> | qq <pesan> | v <media-id>'
  );
  out = out.replace(
    '  r <no> <pesan>        quick reply\n',
    '  r <no> <pesan>        quick reply dari inbox\n  q <no> <pesan>        quote reply pesan di room chat\n  qq <pesan>            quote reply pesan terakhir dari lawan chat\n'
  );
  out = out.replace(
    '  /chats | /contacts [nama] | /search <kata> | /open <target>\n  /send <target> <pesan> | /alias <target> <alias> | /aliases\n',
    '  /chats | /contacts [nama] | /search <kata> | /open <target>\n  /send <target> <pesan> | /reply <no> <pesan>\n  /alias <target> <alias> | /aliases\n'
  );
  out = out.replace(
    "console.log(chalk.gray('Ketik pesan langsung. b/back kembali. v <media-id> buka foto. /vo anti-viewonce. /sensor privasi.'));",
    "console.log(chalk.gray('Ketik pesan langsung. q <no> <pesan> quote reply. qq <pesan> reply pesan terakhir dia. b/back kembali.'));"
  );
  return out;
});

patch('quote slash command', (s) => {
  if (s.includes("if (cmd === '/reply' || cmd === '/quote')")) return s;
  return s.replace(
    "if (cmd === '/send') { const target = args.shift(); const text = args.join(' '); if (!target || !text) throw new Error('Format: /send <target> <pesan>'); return sendText(sock, resolveTarget(target), text); }",
    "if (cmd === '/send') { const target = args.shift(); const text = args.join(' '); if (!target || !text) throw new Error('Format: /send <target> <pesan>'); return sendText(sock, resolveTarget(target), text); }\n  if (cmd === '/reply' || cmd === '/quote') { const idx = args.shift(); const text = args.join(' '); if (!currentChat || !idx || !text) throw new Error('Format: /reply <no> <pesan>'); return sendQuotedText(sock, currentChat, resolveQuoteMessage(idx), text); }"
  );
});

patch('quote shortcuts', (s) => {
  if (s.includes("if (lower.startsWith('qq '))")) return s;
  return s.replace(
    "if (lower.startsWith('r ')) { const [, idx, ...msg] = line.split(' '); const jid = resolveIndex(idx); if (!jid || !msg.join(' ')) throw new Error('Format: r <no> <pesan>'); return sendText(sock, jid, msg.join(' ')); }",
    "if (lower.startsWith('r ')) { const [, idx, ...msg] = line.split(' '); const jid = resolveIndex(idx); if (!jid || !msg.join(' ')) throw new Error('Format: r <no> <pesan>'); return sendText(sock, jid, msg.join(' ')); }\n  if (lower.startsWith('qq ')) { if (!currentChat) throw new Error('qq hanya bisa dipakai di room chat.'); return sendQuotedText(sock, currentChat, resolveLastIncomingQuoteMessage(), line.slice(3).trim()); }\n  if (lower.startsWith('q ') || lower.startsWith('qr ')) { if (!currentChat) throw new Error('q hanya bisa dipakai di room chat.'); const parts = line.split(' '); parts.shift(); const idx = parts.shift(); const text = parts.join(' '); if (!idx || !text) throw quoteIndexError(); return sendQuotedText(sock, currentChat, resolveQuoteMessage(idx), text); }"
  );
});

if (changed) fs.writeFileSync(file, src);

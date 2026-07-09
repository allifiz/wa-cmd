#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), 'src', 'index.ts');
let src = fs.readFileSync(file, 'utf8');

const start = src.includes('function uiWidth(): number')
  ? src.indexOf('function uiWidth(): number')
  : src.indexOf('function renderHeader');
const endCandidates = [
  src.indexOf('type PromptState =', start),
  src.indexOf('function promptLabel(): string', start),
  src.indexOf('function render(): void {', start),
  src.indexOf('function setMode(', start),
].filter((x) => x > start);
const end = Math.min(...endCandidates);

if (start === -1 || !Number.isFinite(end) || end <= start) {
  console.error('Target patch tidak ketemu: render TUI block');
  process.exit(1);
}

const block = [
  "function uiWidth(): number { return Math.max(64, Math.min(process.stdout.columns || 88, 96)); }",
  "function uiLine(label = ''): string { const width = uiWidth(); if (!label) return '─'.repeat(width); const text = ` ${label} `; return text + '─'.repeat(Math.max(0, width - text.length)); }",
  "function uiSoftLine(): string { return '┄'.repeat(uiWidth()); }",
  "function uiKind(jid: string): string { if (jid.endsWith('@g.us')) return 'group'; if (jid.endsWith('@lid')) return 'lid'; if (jid.endsWith('@s.whatsapp.net')) return 'personal'; return 'chat'; }",
  "function uiAlias(jid: string): string { const alias = aliasOf(jid); return alias ? ` @${alias}` : ''; }",
  "function uiDimJid(jid: string): string { return chalk.gray(`${uiKind(jid)}${uiAlias(jid)} · ${jid.replace('@s.whatsapp.net', '').replace('@g.us', '').replace('@lid', '')}`); }",
  "function uiFooter(text: string): void { console.log(chalk.gray(uiLine())); console.log(chalk.gray(text)); console.log(''); }",
  "function uiOneLine(text: string, width = uiWidth()): string { return short(text.replace(/[\\r\\n]+/g, ' ').replace(/\\s+/g, ' ').trim(), width); }",
  "function renderHeader(title = ''): void { console.clear(); const status = reconnecting ? chalk.yellow('○ reconnecting') : chalk.green('● connected'); const modeLabel = mode === 'chat' && currentChat ? `CHAT · ${short(nameOf(currentChat), 32)}` : mode === 'contacts' ? 'CONTACTS' : mode === 'search' ? `SEARCH${filter ? ` · ${short(filter, 22)}` : ''}` : 'INBOX'; console.log(`${chalk.cyan.bold('WA CMD')} ${status} ${chalk.gray('│')} ${chalk.bold(modeLabel)}${title ? chalk.gray(` │ ${title}`) : ''}`); console.log(chalk.gray(uiLine())); }",
  "function renderUnreadBanner(): void { activeUnreadJids = []; const unread = unreadChatsForBanner(); if (!unread.length) return; console.log(chalk.yellow.bold('Unread lain')); unread.forEach((c, i) => { activeUnreadJids.push(c.jid); console.log(`  ${chalk.cyan(`j ${i + 1}`)} ${chalk.bold(short(nameOf(c.jid), 24))} ${chalk.yellow(`(${c.unread})`)} ${chalk.gray(uiOneLine(c.lastMessage, 52))}`); }); console.log(chalk.gray('  Buka dengan j 1 / j 2. Auto-hide setelah 5 menit.')); console.log(chalk.gray(uiLine())); }",
  "function renderList(): void { activeChatMessages = []; activeList = listForMode(); page = Math.min(page, maxPage()); const title = mode === 'contacts' ? `Contacts${filter ? `: ${filter}` : ''}` : mode === 'search' ? `Search: ${filter}` : 'Inbox'; renderHeader(`${page + 1}/${maxPage() + 1}`); console.log(`${chalk.cyan.bold(title)} ${chalk.gray(`· ${activeList.length} item${filter ? ` · filter: ${filter}` : ''}`)}`); console.log(''); const items = pageItems(); if (!items.length) console.log(chalk.yellow(mode === 'inbox' ? 'Inbox masih kosong. Pakai c <nama> untuk kontak, s <nama> untuk search, atau tunggu pesan masuk.' : 'Kosong. Coba keyword lain, import VCF, atau tunggu pesan masuk.')); items.forEach((x, i) => { const jid = rootJid(x.jid); const chat = chats.get(jid); const unread = chat?.unread ?? 0; const unreadBadge = unread ? chalk.yellow(`● ${unread}`) : chalk.gray('○'); const meta = chat ? `${time(chat.lastAt)} · ${uiKind(jid)}${uiAlias(jid)}` : `${x.source} · ${uiKind(jid)}${uiAlias(jid)}`; console.log(`${chalk.cyan(`[${String(i + 1).padStart(2, '0')}]`)} ${unreadBadge} ${chalk.bold(short(x.name, 34))}`); console.log(`     ${chalk.gray(meta)}`); console.log(`     ${chalk.gray(uiOneLine(x.subtitle, uiWidth() - 7))}`); if (i < items.length - 1) console.log(chalk.gray(uiSoftLine())); }); console.log(''); const nav = maxPage() > 0 ? ' · n/p page' : ''; uiFooter(`1-10 buka · j <target> jump · s <kata> search · c <nama> contacts${nav} · d <no> hapus · /help`); }",
  "function renderChat(): void { renderHeader(); if (!currentChat) { mode = 'inbox'; renderList(); return; } currentChat = rootJid(currentChat); const ch = chats.get(currentChat); if (ch) chats.set(currentChat, { ...ch, unread: 0 }); markMessagesSeenForCensor(currentChat); renderUnreadBanner(); console.log(`${chalk.cyan.bold('Room')} ${chalk.bold(nameOf(currentChat))}`); console.log(uiDimJid(currentChat)); if (pendingQuote) console.log(chalk.yellow(`Replying → ${short(quotePreview(pendingQuote.quote) ?? pendingQuote.text, uiWidth() - 12)}`)); const quoteLock = quoteInputSnapshotLabel(); if (quoteLock) console.log(chalk.yellow(quoteLock)); console.log(chalk.gray(uiLine('pesan'))); const allMessages = dedupeMessageList(messages.get(currentChat) ?? []); const hiddenCount = Math.max(0, allMessages.length - CHAT_VIEW_LIMIT); const list = allMessages.slice(-CHAT_VIEW_LIMIT); activeChatMessages = list; if (hiddenCount) console.log(chalk.gray(`↑ ${hiddenCount} pesan lama disembunyikan. Tampilan hanya ${CHAT_VIEW_LIMIT} pesan terakhir.`)); if (!list.length) console.log(chalk.gray('Belum ada pesan lokal untuk chat ini.')); list.forEach((m, i) => { const preview = quotePreview(m.quote); const no = chalk.cyan(`[${String(i + 1).padStart(2, '0')}]`); const dir = m.fromMe ? chalk.green('→') : chalk.magenta('←'); const who = m.fromMe ? chalk.green('kamu') : chalk.magenta(short(m.senderName || 'dia', 20)); const status = messageStatusIcon(m); const body = m.censoredAt ? chalk.gray(uiOneLine(m.text, uiWidth() - 7)) : uiOneLine(m.text, uiWidth() - 7); console.log(`${no} ${chalk.gray(time(m.at))} ${dir} ${who}${status ? ` ${status}` : ''}`); if (preview) console.log(chalk.gray(`     ↪ ${uiOneLine(preview, uiWidth() - 9)}`)); console.log(`     ${body}`); if (i < list.length - 1) console.log(chalk.gray(uiSoftLine())); }); console.log(''); uiFooter('ketik pesan langsung · q <no> <pesan> quote · reply <no> mode · qq <pesan> latest · j <target> jump · b inbox'); }",
].join('\n');

src = `${src.slice(0, start)}${block}\n${src.slice(end)}`;
fs.writeFileSync(file, src);
console.log('patched: enhanced TUI layout applied.');

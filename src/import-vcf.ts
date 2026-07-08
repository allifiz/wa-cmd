#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

type ContactItem = {
  jid: string;
  name: string;
  notify?: string;
  verifiedName?: string;
  updatedAt: number;
};

type ContactStore = Record<string, ContactItem>;

const ROOT_DIR = process.cwd();
const DATA_DIR = path.join(ROOT_DIR, 'data');
const CONTACTS_FILE = path.join(DATA_DIR, 'contacts.json');

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadContacts(): ContactStore {
  ensureDir(DATA_DIR);
  if (!fs.existsSync(CONTACTS_FILE)) return {};

  try {
    return JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf8')) as ContactStore;
  } catch {
    return {};
  }
}

function saveContacts(contacts: ContactStore): void {
  ensureDir(DATA_DIR);
  fs.writeFileSync(CONTACTS_FILE, `${JSON.stringify(contacts, null, 2)}\n`);
}

function unfoldVcf(content: string): string[] {
  const rawLines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const lines: string[] = [];

  for (const line of rawLines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }

  return lines;
}

function decodeQuotedPrintable(value: string): string {
  if (!/=([0-9A-F]{2})/i.test(value)) return value;

  const bytes: number[] = [];
  let output = '';

  function flushBytes(): void {
    if (bytes.length === 0) return;
    output += Buffer.from(bytes).toString('utf8');
    bytes.length = 0;
  }

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const hex = value.slice(index + 1, index + 3);

    if (char === '=' && /^[0-9A-F]{2}$/i.test(hex)) {
      bytes.push(Number.parseInt(hex, 16));
      index += 2;
      continue;
    }

    if (char === '=' && (value[index + 1] === '\n' || value.slice(index + 1, index + 3) === '\r\n')) {
      continue;
    }

    flushBytes();
    output += char;
  }

  flushBytes();
  return output;
}

function cleanVcfValue(value: string): string {
  return decodeQuotedPrintable(value)
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\s+/g, ' ')
    .trim();
}

function valueAfterColon(line: string): string {
  const index = line.indexOf(':');
  if (index === -1) return '';
  return cleanVcfValue(line.slice(index + 1));
}

function nameFromN(value: string): string {
  const parts = value.split(';').map((part) => cleanVcfValue(part)).filter(Boolean);
  return parts.reverse().join(' ').trim();
}

function normalizePhone(raw: string): string | null {
  let phone = raw.replace(/[^0-9+]/g, '');
  if (!phone) return null;

  if (phone.startsWith('+')) phone = phone.slice(1);
  if (phone.startsWith('00')) phone = phone.slice(2);
  if (phone.startsWith('0')) phone = `62${phone.slice(1)}`;

  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.length < 8) return null;

  return digits;
}

function parseVcf(content: string): ContactItem[] {
  const lines = unfoldVcf(content);
  const contacts: ContactItem[] = [];

  let currentName = '';
  let currentN = '';
  let currentPhones: string[] = [];

  function flush(): void {
    const name = currentName || nameFromN(currentN);
    if (!name || currentPhones.length === 0) {
      currentName = '';
      currentN = '';
      currentPhones = [];
      return;
    }

    for (const rawPhone of currentPhones) {
      const phone = normalizePhone(rawPhone);
      if (!phone) continue;

      contacts.push({
        jid: `${phone}@s.whatsapp.net`,
        name,
        notify: name,
        updatedAt: Date.now(),
      });
    }

    currentName = '';
    currentN = '';
    currentPhones = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const upper = line.toUpperCase();

    if (upper === 'BEGIN:VCARD') {
      currentName = '';
      currentN = '';
      currentPhones = [];
      continue;
    }

    if (upper === 'END:VCARD') {
      flush();
      continue;
    }

    if (upper.startsWith('FN')) {
      currentName = valueAfterColon(line) || currentName;
      continue;
    }

    if (upper.startsWith('N')) {
      currentN = valueAfterColon(line) || currentN;
      continue;
    }

    if (upper.startsWith('TEL')) {
      const phone = valueAfterColon(line);
      if (phone) currentPhones.push(phone);
    }
  }

  flush();
  return contacts;
}

const vcfPath = process.argv.slice(2).join(' ').trim();

if (!vcfPath) {
  console.error('Format: npm run import-vcf -- "C:\\path\\contacts.vcf"');
  process.exit(1);
}

const resolvedPath = path.resolve(ROOT_DIR, vcfPath);
if (!fs.existsSync(resolvedPath)) {
  console.error(`File tidak ditemukan: ${resolvedPath}`);
  process.exit(1);
}

const content = fs.readFileSync(resolvedPath, 'utf8');
const importedContacts = parseVcf(content);
const storedContacts = loadContacts();

let imported = 0;
for (const contact of importedContacts) {
  const old = storedContacts[contact.jid];
  storedContacts[contact.jid] = {
    ...old,
    ...contact,
    name: contact.name || old?.name || contact.jid,
    notify: contact.notify || old?.notify,
    updatedAt: Date.now(),
  };
  imported += 1;
}

saveContacts(storedContacts);

console.log(`Imported ${imported} contact phone entries into ${CONTACTS_FILE}`);
console.log('Jalankan wa-cmd lagi, lalu pakai /contacts atau /contacts <nama>.');

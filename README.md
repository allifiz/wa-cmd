# WA CMD

WhatsApp ringan di terminal/CMD, dibuat pakai [Baileys](https://github.com/WhiskeySockets/Baileys).

> Catatan: ini client unofficial untuk eksperimen pribadi. Jangan pakai untuk spam, broadcast massal, scraping, atau aktivitas yang melanggar aturan WhatsApp. Folder `auth/` berisi session sensitif dan jangan pernah di-commit. Fitur view-once hanya gunakan untuk chat milik sendiri atau dengan izin.

## Fitur v0.4

- Login QR langsung dari terminal
- Semi-TUI: inbox otomatis, pagination 10 item per halaman
- Shortcut angka `1-10` untuk buka chat/kontak di halaman aktif
- Shortcut `n` / `p` untuk next/previous page
- Shortcut `s <nama>` untuk search gabungan chat + kontak
- Shortcut `c <nama>` untuk filter contacts
- Shortcut `r <no> <pesan>` untuk quick reply tanpa buka chat
- Chat mode: ketik pesan langsung tanpa `/send`
- Alias lokal, misalnya `@bot`, `@matcha`, `@bos`
- Import kontak HP dari `.vcf`
- Cache lokal untuk contacts, recent chats, dan pesan terakhir
- Simpan foto yang masuk ke `data/media/images`
- Anti-viewonce lokal: foto view-once yang masuk saat app aktif otomatis disimpan sementara ke `data/media/images/view-once`
- Command `/viewonce` atau `/vo` untuk status, list, buka, dan auto-forward foto view-once
- Shortcut `v <media-id>` untuk membuka foto tersimpan

## Requirement

- Node.js 20+
- npm

## Jalankan untuk development

```bash
git clone https://github.com/allifiz/wa-cmd.git
cd wa-cmd
npm install
npm run dev
```

Saat QR muncul, buka WhatsApp di HP:

```txt
Settings > Linked devices > Link a device
```

Lalu scan QR di terminal.

## Biar bisa dipanggil dari CMD pakai `wa-cmd`

Dari folder repo:

```bash
npm install
npm run build
npm link
```

Setelah itu bisa buka CMD/PowerShell dari mana saja lalu ketik:

```bash
wa-cmd
```

Kalau ingin melepas command global:

```bash
npm unlink -g wa-cmd
```

## Import kontak HP

Export kontak dari HP ke file `.vcf`, lalu import ke wa-cmd:

```bash
npm run import-vcf -- "C:\Users\Lenovo\Downloads\contacts.vcf"
```

Import ulang aman. Kontak disimpan berdasarkan JID/nomor, jadi nomor yang sama akan di-update, bukan diduplikasi.

## Shortcut utama

```txt
1-10                  buka item halaman aktif
n / p                 next / prev page
b / back              kembali ke inbox
s <kata>              search chat + kontak
c <kata>              filter contacts
r <no> <pesan>        quick reply ke item di halaman aktif
v <media-id>          buka foto/media tersimpan, contoh v1, v 7, vv12
vo                    cek status anti-viewonce
vo list               list view-once tersimpan
vo set <target>       auto-forward view-once ke target
vo off                matikan auto-forward view-once
@alias <pesan>        quick send ke alias
q                     keluar
```

## Slash command

```txt
/help                        tampilkan bantuan
/chats                       tampilkan inbox
/contacts [nama]             lihat/cari kontak + chat tersimpan
/search <kata>               cari chat + kontak
/open <target>               buka chat
/send <target> <pesan>       kirim pesan
/alias <target> <alias>      simpan alias lokal
/aliases                     lihat daftar alias
/view <media-id>             buka foto/media tersimpan
/viewonce status             cek status anti-viewonce
/viewonce set <target>       auto-forward view-once ke target
/viewonce off                matikan auto-forward view-once
/viewonce list               daftar view-once tersimpan
/viewonce open <id>          buka view-once tersimpan
/vo ...                      alias singkat untuk /viewonce
/logout                      hapus session WhatsApp lokal
/clear                       render ulang layar
/exit                        keluar
```

## Contoh pakai UX baru

Cari kontak/chat:

```txt
s bot
c adit
```

Buka item nomor 1 di halaman aktif:

```txt
1
```

Saat sudah masuk chat, cukup ketik pesan biasa:

```txt
siap, nanti aku cek
```

Quick reply tanpa buka chat:

```txt
r 2 kerja kok
```

Bikin alias:

```txt
/alias 1 bot
@bot halo
```

Pagination:

```txt
n
p
```

## Anti-viewonce

WA CMD akan mencoba menyimpan foto view-once yang masuk saat app sedang aktif. File tersimpan sementara di:

```txt
data/media/images/view-once
```

Cek status:

```txt
/vo
/viewonce status
```

Lihat daftar view-once yang berhasil disimpan:

```txt
/vo list
/viewonce list
```

Buka view-once tersimpan:

```txt
v1
/viewonce open v1
```

Aktifkan auto-forward ke chat tertentu:

```txt
/viewonce set 6281234567890
```

Atau pakai alias/kontak yang sudah dikenal wa-cmd:

```txt
/alias 1 me
/viewonce set @me
```

Matikan auto-forward:

```txt
/viewonce off
```

Catatan:

- Fitur ini hanya menangkap view-once yang masuk saat `wa-cmd` aktif.
- File view-once akan dibersihkan saat app keluar/logout, mengikuti perilaku temporary cache.
- Auto-forward target disimpan di `data/settings.json`.

## Data lokal

File/folder yang dibuat otomatis:

```txt
auth/                         session WhatsApp lokal
data/aliases.json             alias lokal
data/settings.json            setting lokal, termasuk target auto-forward view-once
data/contacts.json            cache kontak lokal hasil sync/import VCF
data/chats.json               cache recent chats lokal
data/messages.json            cache pesan lokal terakhir per chat
data/media.json               index media lokal
data/media/images/            foto yang masuk saat app aktif
data/media/images/view-once/  foto view-once temporary saat app aktif
```

Folder `auth/` dan `data/` sudah masuk `.gitignore`.

## Catatan history

WA CMD menyimpan pesan yang diterima/dikirim saat app aktif ke `data/messages.json`. Jadi kalau app dibuka ulang, chat mode bisa menampilkan pesan lokal terakhir.

History lama dari WhatsApp HP/WhatsApp Web belum dijamin tersinkron penuh, karena Baileys berjalan sebagai companion WhatsApp Web dan tidak selalu menerima semua isi history lama.

## Catatan kontak

Baileys tidak selalu dapat semua kontak lokal HP secara otomatis. Untuk daftar kontak lengkap, cara paling stabil adalah export kontak HP ke `.vcf`, lalu import dengan `npm run import-vcf`.

## Kalau muncul `Bad MAC` / gagal decrypt

Kadang Baileys/libsignal gagal decrypt pesan tertentu karena session key belum sinkron, pesan lama di-retry, atau Linked Device sempat bentrok. Log noisy seperti `Failed to decrypt message with any known session` dan `Bad MAC` disembunyikan supaya terminal tetap bersih.

Kalau pesan baru tetap tidak kebaca terus-menerus, reset session:

```txt
/logout
```

Lalu hapus device `WA CMD` dari WhatsApp HP:

```txt
Settings > Linked devices > pilih WA CMD > Log out
```

Setelah itu jalankan lagi `wa-cmd` dan scan QR ulang.

## Batasan v0.4

- Belum sync semua isi history lama WhatsApp.
- Beberapa pesan lama/retry bisa gagal decrypt di Baileys.
- Belum support kirim gambar/file manual dari terminal.
- UI terminal bisa agak berantakan kalau pesan masuk tepat saat mengetik.
- View-once hanya bisa disimpan kalau pesan masuk saat app aktif dan berhasil didecrypt oleh Baileys.

## Roadmap ide berikutnya

- Kirim gambar/file dari terminal
- Mode fuzzy search yang lebih pintar untuk nama unicode/emoji
- Export chat lokal
- Notifikasi Windows
- Multi-account profile

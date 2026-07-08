# WA CMD

WhatsApp ringan di terminal/CMD, dibuat pakai [Baileys](https://github.com/WhiskeySockets/Baileys).

> Catatan: ini client unofficial untuk eksperimen pribadi. Jangan pakai untuk spam, broadcast massal, scraping, atau aktivitas yang melanggar aturan WhatsApp. Folder `auth/` berisi session sensitif dan jangan pernah di-commit.

## Fitur v0.2

- Login QR langsung dari terminal
- Menerima pesan realtime
- Kirim pesan dari command line
- Lihat daftar chat terakhir
- Lihat kontak yang tersinkron dari WhatsApp Web
- Buka chat pakai index, nama kontak, nomor, JID, atau alias
- Alias lokal, misalnya `@bos`, `@raihan`, `@backend`
- Logout dengan hapus session lokal

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

## Command

```txt
/help                         tampilkan bantuan
/chats                        lihat chat terakhir
/contacts [nama]              lihat/cari kontak yang tersinkron
/search <kata>                cari chat berdasarkan nama/JID/alias
/open <index|nama|@alias|jid> buka chat
/close                        keluar dari chat aktif
/send <target> <pesan>        kirim pesan ke nomor/index/nama/@alias/JID
/alias <target> <alias>       simpan alias lokal
/aliases                      lihat daftar alias
/logout                       hapus session WhatsApp lokal
/clear                        bersihkan layar
/exit                         keluar
```

## Contoh pakai

Lihat kontak:

```txt
/contacts
```

Cari kontak:

```txt
/contacts raihan
```

Buka chat dari nama kontak:

```txt
/open raihan
```

Kirim ke nomor:

```txt
/send 6281234567890 halo dari terminal
```

Lihat chat terakhir:

```txt
/chats
```

Buka chat nomor 1 dari daftar:

```txt
/open 1
```

Setelah chat dibuka, ketik pesan biasa:

```txt
siap, nanti aku cek
```

Bikin alias:

```txt
/alias 1 bos
/send @bos siap pak
```

## Data lokal

File/folder yang dibuat otomatis:

```txt
auth/                session WhatsApp lokal
data/aliases.json    alias lokal
data/contacts.json   cache kontak lokal
```

Folder `auth/` dan `data/` sudah masuk `.gitignore`.

## Catatan kontak

Baileys berjalan sebagai companion WhatsApp Web. Artinya kontak yang muncul bergantung pada data yang dikirim WhatsApp Web ke session ini. Biasanya kontak akan makin lengkap setelah WhatsApp selesai sync, setelah ada pesan masuk, atau setelah kamu membuka/berinteraksi dengan chat terkait.

Kalau `/contacts` masih kosong, coba tunggu beberapa saat setelah `Connected ✓`, kirim pesan dari HP lain ke akunmu, atau buka kontak tersebut dari WhatsApp HP lalu jalankan ulang `wa-cmd`.

## Kalau muncul `Bad MAC` / gagal decrypt

Kadang Baileys/libsignal gagal decrypt pesan tertentu karena session key belum sinkron, pesan lama di-retry, atau Linked Device sempat bentrok. Di versi ini log noisy seperti `Failed to decrypt message with any known session` dan `Bad MAC` sudah disembunyikan supaya terminal tetap bersih.

Kalau pesan baru tetap tidak kebaca terus-menerus, reset session:

```txt
/logout
```

Lalu hapus device `WA CMD` dari WhatsApp HP:

```txt
Settings > Linked devices > pilih WA CMD > Log out
```

Setelah itu jalankan lagi `wa-cmd` dan scan QR ulang.

## Batasan v0.2

- Belum tentu semua kontak HP mentah langsung muncul seperti aplikasi Contacts Android.
- Belum sync semua history WhatsApp.
- Beberapa pesan lama/retry bisa gagal decrypt di Baileys.
- Belum support kirim gambar/file.
- UI terminal bisa agak berantakan kalau pesan masuk saat kamu sedang mengetik.

## Roadmap ide berikutnya

- Simpan recent chats ke `data/chats.json`
- Kirim gambar/file dari terminal
- Mode fuzzy search yang lebih enak
- Export chat lokal
- Notifikasi Windows
- Multi-account profile

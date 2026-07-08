# WA CMD

WhatsApp ringan di terminal/CMD, dibuat pakai [Baileys](https://github.com/WhiskeySockets/Baileys).

> Catatan: ini client unofficial untuk eksperimen pribadi. Jangan pakai untuk spam, broadcast massal, scraping, atau aktivitas yang melanggar aturan WhatsApp. Folder `auth/` berisi session sensitif dan jangan pernah di-commit.

## Fitur v0.1

- Login QR langsung dari terminal
- Menerima pesan realtime
- Kirim pesan dari command line
- Lihat daftar chat terakhir
- Buka chat lalu balas dengan mengetik biasa
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
/search <kata>                cari chat berdasarkan nama/JID/alias
/open <index|@alias|jid>      buka chat
/close                        keluar dari chat aktif
/send <target> <pesan>        kirim pesan ke nomor/index/@alias/JID
/alias <index|jid|nomor> <a>  simpan alias lokal
/aliases                      lihat daftar alias
/logout                       hapus session WhatsApp lokal
/clear                        bersihkan layar
/exit                         keluar
```

## Contoh pakai

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
auth/              session WhatsApp lokal
data/aliases.json  alias lokal
```

Dua folder itu sudah masuk `.gitignore`.

## Batasan v0.1

- Nama kontak bergantung dari pesan yang masuk, jadi awalnya daftar chat bisa kosong.
- Belum sync semua history WhatsApp.
- Belum support kirim gambar/file.
- UI terminal bisa agak berantakan kalau pesan masuk saat kamu sedang mengetik.

## Roadmap ide berikutnya

- Simpan recent chats ke `data/chats.json`
- Kirim gambar/file dari terminal
- Mode fuzzy search yang lebih enak
- Export chat lokal
- Notifikasi Windows
- Multi-account profile

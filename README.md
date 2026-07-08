# WA CMD

WA CMD adalah client WhatsApp ringan berbasis terminal/CMD. Project ini dibuat dengan [Baileys](https://github.com/WhiskeySockets/Baileys) untuk orang yang ingin membuka WhatsApp tanpa aplikasi desktop/browser yang berat.

> **Catatan penting**
>
> Ini adalah client unofficial untuk eksperimen pribadi. Jangan gunakan untuk spam, broadcast massal, scraping, brute force, atau aktivitas yang melanggar aturan WhatsApp. Folder `auth/` berisi session WhatsApp dan harus dijaga seperti password. Jangan commit atau membagikan folder `auth/` dan `data/`.

## Fitur utama

- Login WhatsApp lewat QR di terminal.
- Inbox ringan dengan pagination.
- Buka chat pakai angka `1-10`.
- Search chat dan kontak.
- Kirim pesan langsung dari chat mode.
- Quick reply tanpa perlu membuka chat.
- Alias lokal seperti `@bot`, `@me`, atau `@kantor`.
- Import kontak dari file `.vcf`.
- Cache lokal untuk chat, kontak, pesan terakhir, alias, dan media.
- Simpan gambar yang masuk saat app aktif.
- Dukungan view-once capture saat pesan berhasil didecrypt oleh Baileys.
- Auto-forward view-once ke target tertentu.
- Notifikasi desktop Windows untuk pesan masuk.
- Helper cache untuk merge chat duplikat, hapus cache lokal, dan cek daftar cache.

## Requirement

- Node.js 20 atau lebih baru.
- npm.
- Terminal/CMD/PowerShell.
- WhatsApp di HP untuk scan QR Linked Device.

Cek versi Node:

```bash
node -v
npm -v
```

## Quick start

Clone repo dan install dependency:

```bash
git clone https://github.com/allifiz/wa-cmd.git
cd wa-cmd
npm install
```

Jalankan mode development:

```bash
npm run dev
```

Saat QR muncul, buka WhatsApp di HP:

```txt
Settings > Linked devices > Link a device
```

Scan QR dari terminal. Setelah tersambung, inbox akan tampil di terminal.

## Build dan jalankan dari mana saja

Dari folder repo:

```bash
npm install
npm run build
npm link
```

Setelah itu command global tersedia:

```bash
wa-cmd
```

Kalau ingin menjalankan build tanpa global command:

```bash
node dist/index.js
```

Kalau ada update dari GitHub:

```bash
git pull
git checkout -- src/index.ts
npm install
npm run build
npm link
wa-cmd
```

`git checkout -- src/index.ts` berguna karena project ini punya runtime patcher yang bisa mengubah `src/index.ts` lokal saat `npm run dev` atau `npm run build`.

## Cara pakai dasar

Di inbox, gunakan shortcut berikut:

```txt
1-10                  buka item pada halaman aktif
n                     next page
p                     previous page
b / back              kembali ke inbox
s <kata>              search chat + kontak
c <kata>              filter kontak
r <no> <pesan>        quick reply ke item di halaman aktif
v <media-id>          buka media tersimpan, contoh v1 atau v 7
vo                    cek status view-once
vo list               list view-once tersimpan
vo set <target>       auto-forward view-once ke target
vo off                matikan auto-forward view-once
@alias <pesan>        kirim cepat ke alias
q                     keluar
```

Saat sudah masuk chat, ketik pesan biasa lalu tekan Enter:

```txt
halo, ini dikirim dari terminal
```

Quick reply dari inbox:

```txt
r 2 siap, nanti aku cek
```

Search:

```txt
s budi
c kantor
```

## Slash command

```txt
/help                        tampilkan bantuan
/chats                       tampilkan inbox
/contacts [nama]             lihat atau cari kontak
/search <kata>               cari chat + kontak
/open <target>               buka chat
/send <target> <pesan>       kirim pesan
/alias <target> <alias>      simpan alias lokal
/aliases                     lihat daftar alias
/view <media-id>             buka media tersimpan
/viewonce status             cek status view-once
/viewonce set <target>       auto-forward view-once ke target
/viewonce off                matikan auto-forward view-once
/viewonce list               daftar view-once tersimpan
/viewonce open <id>          buka view-once tersimpan
/vo ...                      alias singkat untuk /viewonce
/logout                      hapus session WhatsApp lokal
/clear                       render ulang layar
/exit                        keluar
```

## Target dan alias

Banyak command menerima `target`. Target bisa berupa:

- Nomor WhatsApp, contoh `6281234567890`.
- JID lengkap, contoh `6281234567890@s.whatsapp.net`.
- Nomor item pada halaman aktif, contoh `1`.
- Nama kontak/chat yang sudah tersimpan.
- Alias lokal, contoh `@me`.

Membuat alias:

```txt
/alias 1 me
/alias 6281234567890 kantor
```

Mengirim pesan ke alias:

```txt
@me test dari wa-cmd
/send @kantor halo
```

Lihat daftar alias:

```txt
/aliases
```

## Import kontak dari HP

Baileys tidak selalu mendapat semua kontak lokal HP. Cara paling stabil adalah export kontak HP ke `.vcf`, lalu import ke WA CMD.

Contoh Windows:

```bash
npm run import-vcf -- "C:\Users\Lenovo\Downloads\contacts.vcf"
```

Contoh Linux/macOS:

```bash
npm run import-vcf -- ~/Downloads/contacts.vcf
```

Import ulang aman. Nomor yang sama akan di-update, bukan dibuat dobel.

## Notifikasi Windows

WA CMD memakai `node-notifier` dan `WindowsToaster` untuk popup notifikasi pesan masuk di Windows.

Test notifikasi:

```bash
npm run notify:test
```

Kalau `notify:test` muncul popup, notifikasi Windows sudah aktif. Setelah build, pesan masuk dari orang lain harus memanggil popup juga.

Untuk memastikan build terbaru sudah memuat notifier:

```bat
findstr /n /c:"WindowsToaster" src\index.ts dist\index.js
findstr /n /c:"notifier.notify" dist\index.js
findstr /n /c:"notifyNewMessage" dist\index.js
```

Kalau `node dist/index.js` popup tetapi `wa-cmd` tidak, update global link:

```bash
npm link
wa-cmd
```

Kalau hanya bunyi tanpa popup, cek pengaturan Windows:

```txt
Settings > System > Notifications
```

Pastikan:

- Notifications aktif.
- Do not disturb mati.
- Banner notification aktif.
- Terminal/PowerShell/Windows Console Host tidak diblokir.

## View-once dan media

WA CMD mencoba menyimpan gambar yang masuk saat app aktif. File biasa disimpan ke:

```txt
data/media/images
```

View-once yang berhasil ditangkap disimpan sementara ke:

```txt
data/media/images/view-once
```

Cek status view-once:

```txt
/vo
/viewonce status
```

Lihat list view-once:

```txt
/vo list
/viewonce list
```

Buka media/view-once tersimpan:

```txt
v1
/viewonce open v1
```

Auto-forward view-once ke target:

```txt
/viewonce set 6281234567890
```

Atau pakai alias:

```txt
/alias 1 me
/viewonce set @me
```

Matikan auto-forward:

```txt
/viewonce off
```

Batasan view-once:

- Hanya bisa ditangkap kalau WA CMD sedang aktif.
- Hanya bisa ditangkap kalau pesan berhasil didecrypt oleh Baileys.
- Tidak menjamin bisa mengambil view-once lama dari history.
- Gunakan hanya untuk chat milik sendiri atau dengan izin.

## Cache lokal

WA CMD menyimpan data lokal di folder `data/` dan session di `auth/`.

```txt
auth/                         session WhatsApp lokal
data/aliases.json             alias lokal
data/settings.json            setting lokal, termasuk target auto-forward view-once
data/contacts.json            cache kontak lokal hasil sync/import VCF
data/chats.json               cache recent chats lokal
data/messages.json            cache pesan lokal terakhir per chat
data/media.json               index media lokal
data/jid-links.json           mapping chat duplikat, terutama @lid ke nomor asli
data/media/images/            gambar yang masuk saat app aktif
data/media/images/view-once/  gambar view-once temporary saat app aktif
```

Folder `auth/` dan `data/` sudah masuk `.gitignore`.

## Mengelola cache chat

Kadang WhatsApp/Baileys memunculkan chat yang sama sebagai nomor biasa dan sebagai `@lid`. WA CMD punya helper cache untuk merapikan data lokal.

Lihat daftar cache chat:

```bash
npm run cache:list
```

Merge chat duplikat:

```bash
npm run cache:merge -- <from> <to>
```

Contoh:

```bash
npm run cache:merge -- Sin sayang
npm run cache:merge -- "154202831605893@lid" "6285759907854@s.whatsapp.net"
```

Hapus cache lokal chat tertentu:

```bash
npm run cache:remove -- <target>
```

Contoh menghapus cache newsletter lokal:

```bash
npm run cache:remove -- 120363423633871300@newsletter
```

Command ini hanya mengubah cache lokal WA CMD. Chat asli di WhatsApp tidak ikut terhapus.

## Customisasi yang umum

### Mengubah cooldown notifikasi

Cari di `src/index.ts`:

```ts
const NOTIFICATION_COOLDOWN_MS = 1200;
```

Naikkan kalau popup terlalu sering, turunkan kalau ingin lebih responsif.

### Mengubah jumlah item per halaman

Cari konstanta pagination di `src/index.ts`, lalu ubah sesuai kebutuhan. Setelah edit:

```bash
npm run build
```

### Menghapus semua session dan mulai ulang

Dari dalam app:

```txt
/logout
```

Lalu hapus device dari HP:

```txt
Settings > Linked devices > pilih WA CMD > Log out
```

Jalankan lagi dan scan QR ulang:

```bash
wa-cmd
```

## Script npm

```txt
npm run dev             jalankan source TypeScript langsung
npm run build           patch runtime lalu compile ke dist/
npm start               jalankan dist/index.js
npm run import-vcf      import kontak dari file .vcf
npm run notify:test     test popup notifikasi Windows
npm run cache:list      lihat cache chat lokal
npm run cache:merge     merge dua cache chat lokal
npm run cache:remove    hapus cache chat lokal
a npm run typecheck     cek TypeScript tanpa emit
```

> Kalau melihat typo `a npm run typecheck` pada output/copy, command yang benar adalah `npm run typecheck`.

## Troubleshooting

### `wa-cmd` tidak memakai build terbaru

Jalankan:

```bash
npm run build
node dist/index.js
```

Kalau `node dist/index.js` benar tetapi `wa-cmd` tidak, update global link:

```bash
npm link
wa-cmd
```

Cek lokasi command global di Windows:

```bat
where wa-cmd
```

### Popup notifikasi tidak muncul

Urutan cek:

```bash
npm run notify:test
npm run build
node dist/index.js
```

Lalu kirim pesan dari nomor lain ke akun yang login di WA CMD.

Catatan: kalau pesan dikirim dari device akun yang sama, Baileys bisa membaca pesan itu sebagai `fromMe = true`, sehingga bukan dianggap pesan masuk dari orang lain.

### `Bad MAC` atau gagal decrypt

Kadang Baileys/libsignal gagal decrypt pesan tertentu karena session key belum sinkron, pesan lama di-retry, atau Linked Device sempat bentrok. Log seperti `Failed to decrypt message with any known session` dan `Bad MAC` bisa muncul dari Baileys.

Kalau pesan baru terus gagal kebaca, reset session:

```txt
/logout
```

Lalu hapus device `WA CMD` dari WhatsApp HP:

```txt
Settings > Linked devices > pilih WA CMD > Log out
```

Jalankan ulang dan scan QR lagi.

### Kontak tidak lengkap

Import kontak dari `.vcf`:

```bash
npm run import-vcf -- "path\to\contacts.vcf"
```

### Chat dobel antara nomor dan `@lid`

Gunakan cache helper:

```bash
npm run cache:list
npm run cache:merge -- <from> <to>
```

## Batasan

- Belum menjamin sync semua history lama WhatsApp.
- Beberapa pesan lama/retry bisa gagal decrypt di Baileys.
- Belum support kirim gambar/file manual dari terminal.
- UI terminal bisa bergeser kalau pesan masuk tepat saat mengetik.
- View-once hanya bisa ditangkap saat app aktif dan pesan berhasil didecrypt.
- Ini bukan pengganti resmi WhatsApp Desktop.

## Roadmap ide

- Kirim gambar/file dari terminal.
- Fuzzy search yang lebih pintar untuk nama unicode/emoji.
- Export chat lokal.
- Multi-profile/multi-account lokal.
- Konfigurasi lewat file `.env` atau `config.json`.

## License

Gunakan secara bertanggung jawab untuk kebutuhan pribadi/eksperimen.

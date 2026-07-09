# WA CMD

WA CMD adalah client WhatsApp ringan berbasis terminal/CMD yang memakai Baileys. Tujuannya sederhana: buka dan balas WhatsApp tanpa WhatsApp Desktop atau browser Chromium yang berat.

> **Catatan penting**
>
> Ini client unofficial untuk kebutuhan pribadi/eksperimen. Jangan gunakan untuk spam, broadcast massal, scraping, brute force, atau aktivitas yang melanggar aturan WhatsApp. Folder `auth/` berisi session WhatsApp dan harus dijaga seperti password. Jangan commit atau membagikan folder `auth/` dan `data/`.

## Fitur utama

- Login WhatsApp lewat QR Linked Device.
- Inbox terminal ringan dengan pagination.
- Buka chat pakai angka `1-10`.
- Search chat dan kontak.
- Kirim pesan langsung dari chat mode.
- Quick reply dari inbox.
- Quote reply dengan `q`, `reply`, dan `qq`.
- Reply mode: pilih pesan dulu, lalu ketik balasan berikutnya.
- Alias lokal seperti `@sayang`, `@bot`, atau `@kantor`.
- Nama lokal dengan `/name` dan `/unname`.
- Delete/hapus cache chat lokal langsung dari inbox.
- Import kontak dari file `.vcf`.
- Cache lokal untuk chat, kontak, pesan terakhir, alias, nama lokal, media, dan mapping JID.
- Helper cache untuk merge chat duplikat, hapus cache lokal, merge berdasarkan index inbox, dan prefer LID delivery.
- Notifikasi desktop Windows untuk pesan masuk.
- Sensor pesan lokal setelah pesan dibuka/dibalas.

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

Scan QR dari terminal. Setelah tersambung, inbox akan tampil.

## Update dari GitHub

Kalau sudah pernah clone repo:

```bash
cd /path/ke/wa-cmd
git pull
npm install
npm run typecheck
npm run dev
```

Kalau sebelumnya pernah menjalankan fixer lokal atau source kamu kotor, reset source dulu:

```bash
git checkout -- src/index.ts package.json
npm install
npm run typecheck
npm run dev
```

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

## Cara pakai dasar

Di inbox:

```txt
1-10                  buka item halaman aktif
n                     next page
p                     previous page
b / back              kembali ke inbox
s <kata>              search chat + kontak
c <kata>              filter kontak
j <target>            pindah chat cepat
d <target>            hapus cache chat lokal, contoh d 3
r <no> <pesan>        quick reply ke item di halaman aktif
v <media-id>          buka media tersimpan, contoh v1 atau v 7
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

Hapus cache chat lokal dari inbox:

```txt
d 3
```

Ini hanya menghapus cache lokal WA CMD. Chat asli di WhatsApp tidak ikut terhapus.

Search:

```txt
s budi
c kantor
```

Jump/pindah chat cepat:

```txt
j sayang
j @bot
j 1
```

## Quote reply

Di room chat, pesan yang terlihat punya nomor `[1]` sampai `[10]`.

Kirim quote reply langsung:

```txt
q 4 iya, aku jawab ini
```

Masuk reply mode:

```txt
reply 4
```

Setelah itu prompt akan berubah jadi mode reply. Ketik pesan berikutnya untuk mengirim quote reply. Batalkan dengan:

```txt
cancel
```

Quote pesan terakhir dari lawan chat:

```txt
qq iya aku paham
```

Preview quote hanya muncul kalau pesan memang benar-benar reply/quote message lain.

## Slash command

```txt
/help                         tampilkan bantuan
/chats                        tampilkan inbox
/contacts [nama]              lihat atau cari kontak
/search <kata>                cari chat + kontak
/open <target>                buka chat
/jump <target>                pindah chat cepat
/send <target> <pesan>        kirim pesan
/reply <no> [pesan]           quote reply atau masuk reply mode
/quote <no> [pesan]           alias untuk /reply
/link <from> <to>             link/merge chat duplikat
/merge <from> <to>            alias untuk /link
/delete <target>              hapus cache chat lokal
/del <target>                 alias untuk /delete
/rm <target>                  alias untuk /delete
/alias [target] <alias>       simpan alias lokal
/aliases                      lihat daftar alias
/name [target] <nama>         simpan nama lokal
/unname [target]              hapus nama lokal
/view <media-id>              buka media tersimpan
/sensor status                cek status sensor lokal
/sensor on                    aktifkan sensor lokal
/sensor off                   matikan sensor lokal
/sensor now                   sensor pesan yang sudah ditandai
/logout                       hapus session WhatsApp lokal
/clear                        render ulang layar
/exit                         keluar
```

## Target dan alias

Banyak command menerima `target`. Target bisa berupa:

- Nomor WhatsApp, contoh `6281234567890`.
- JID lengkap, contoh `6281234567890@s.whatsapp.net` atau `123456@lid`.
- Nomor item pada halaman aktif, contoh `1`.
- Nama kontak/chat yang sudah tersimpan.
- Alias lokal, contoh `@sayang`.
- `.` atau `this` saat sedang di room chat.

Membuat alias:

```txt
/alias 1 sayang
/alias 6281234567890 kantor
```

Di dalam room chat, target bisa dihilangkan:

```txt
/alias sayang
/name sayang
```

Mengirim pesan ke alias:

```txt
@sayang lagi apa?
/send @kantor halo
```

Lihat daftar alias:

```txt
/aliases
```

## Nama lokal

Kadang WhatsApp/Baileys menampilkan chat sebagai `@lid`, nomor, atau nama profil yang tidak sesuai kontak. Pakai nama lokal untuk merapikan tampilan:

```txt
/name 1 sayang
/name 6281234567890 kantor
/name . matcha
```

Hapus nama lokal:

```txt
/unname 1
/unname .
```

Nama lokal hanya berlaku di WA CMD dan tidak mengubah kontak asli di HP.

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

Catatan: kontak dari VCF biasanya berbasis nomor `628xxx@s.whatsapp.net`. Kalau WhatsApp mengirim chat sebagai `@lid`, WA CMD akan mencoba memakai metadata dari Baileys untuk mencocokkan nomor kontak dengan LID. Kalau metadata itu tidak tersedia, pakai `/name`, `/alias`, atau helper cache.

## LID, nomor, dan ceklis satu

WhatsApp/Baileys kadang menampilkan orang yang sama dalam dua bentuk:

```txt
6281234567890@s.whatsapp.net
123456789@lid
```

Untuk delivery modern, `@lid` sering menjadi target yang lebih aman. Karena itu arah mapping yang diinginkan adalah:

```txt
6281234567890@s.whatsapp.net -> 123456789@lid
```

Artinya:

- Nomor dari VCF dipakai untuk nama kontak.
- LID dipakai sebagai target kirim aktif.
- Tampilan tetap bisa rapi memakai nama lokal atau alias.

Kalau pesan dari CMD cuma ceklis satu sementara pesan dari HP ceklis dua, coba:

```bash
npm run cache:prefer-lid -- list
npm run cache:prefer-lid -- apply
npm run dev
```

Kalau source lokal belum punya resolver LID terbaru, jalankan fixer:

```bash
npm run fix:lid-delivery
npm run typecheck
npm run cache:prefer-lid -- apply
npm run dev
```

## Cache lokal

WA CMD menyimpan data lokal di folder `data/` dan session di `auth/`.

```txt
auth/                         session WhatsApp lokal
data/aliases.json             alias lokal
data/settings.json            setting lokal
data/contacts.json            cache kontak lokal hasil sync/import VCF
data/chats.json               cache recent chats lokal
data/messages.json            cache pesan lokal terakhir per chat
data/media.json               index media lokal
data/jid-links.json           mapping JID/room duplikat
data/local-names.json         nama lokal buatan user
data/media/images/            gambar/media yang masuk saat app aktif
```

Folder `auth/` dan `data/` sudah masuk `.gitignore`.

## Mengelola cache chat

Dari dalam WA CMD, hapus chat lokal dari inbox:

```txt
d 3
/delete 3
```

Command ini hanya menghapus cache lokal WA CMD. Chat asli di WhatsApp tidak ikut terhapus.

Lihat daftar cache chat dari terminal:

```bash
npm run cache:list
```

Merge chat duplikat berdasarkan target:

```bash
npm run cache:merge -- <from> <to>
```

Contoh:

```bash
npm run cache:merge -- asw bapak
npm run cache:merge -- "xxxxx@lid" "xxxxxxx@s.whatsapp.net"
```

Merge berdasarkan index inbox cache. Ini berguna kalau nama tampilannya rusak atau susah diketik:

```bash
npm run cache:merge-index -- list
npm run cache:merge-index -- merge <from-index> <to-index>
```

Contoh:

```bash
npm run cache:merge-index -- merge 3 2
```

Prefer LID delivery untuk mapping lama yang arahnya masih `LID -> nomor`:

```bash
npm run cache:prefer-lid -- list
npm run cache:prefer-lid -- apply
```

Hapus cache lokal chat tertentu dari terminal:

```bash
npm run cache:remove -- <target>
```

Contoh:

```bash
npm run cache:remove -- 6285524748683-1578590028@g.us
```

Command cache hanya mengubah cache lokal WA CMD. Chat asli di WhatsApp tidak ikut terhapus.

## Sensor pesan lokal

WA CMD bisa menyensor pesan lokal setelah chat dibuka atau dibalas. Ini hanya mengubah tampilan/cache lokal, bukan pesan asli di WhatsApp.

```txt
/sensor status
/sensor on
/sensor off
/sensor now
```

Default delay sensor ada di source:

```ts
const MESSAGE_CENSOR_DELAY_MS = 5 * 60 * 1000;
```

## Notifikasi Windows

WA CMD memakai bunyi terminal dan popup PowerShell untuk pesan masuk di Windows.

Test notifikasi:

```bash
npm run notify:test
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

## Script npm

```txt
npm run dev                 jalankan source TypeScript langsung
npm run build               compile ke dist/
npm start                   jalankan dist/index.js
npm run import-vcf          import kontak dari file .vcf
npm run notify:test         test popup notifikasi Windows
npm run cache:list          lihat cache chat lokal
npm run cache:merge         merge dua cache chat lokal
npm run cache:merge-index   merge cache berdasarkan index list
npm run cache:prefer-lid    balik mapping lama agar delivery prefer @lid
npm run cache:remove        hapus cache chat lokal
npm run fix:lid-delivery    patch source lokal untuk resolver LID terbaru
npm run fix:delete-chat     patch source lokal untuk command delete chat
npm run typecheck           cek TypeScript tanpa emit
```

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

### `Decrypted message with closed session`, `Bad MAC`, atau gagal decrypt

Kadang Baileys/libsignal gagal decrypt pesan tertentu karena session key belum sinkron, pesan lama di-retry, atau Linked Device sempat bentrok. Kalau pesan tetap masuk normal, log itu biasanya bisa diabaikan.

Kalau pesan baru terus gagal kebaca atau kiriman dari CMD sering ceklis satu, coba reset session:

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

Kalau yang muncul adalah `@lid`, gunakan:

```txt
/name 1 nama-kontak
/alias 1 alias
```

atau rapikan mapping:

```bash
npm run cache:prefer-lid -- apply
```

### Chat dobel antara nomor dan `@lid`

Gunakan cache helper:

```bash
npm run cache:list
npm run cache:prefer-lid -- list
npm run cache:prefer-lid -- apply
```

Kalau nama susah diketik, pakai index:

```bash
npm run cache:merge-index -- list
npm run cache:merge-index -- merge <from-index> <to-index>
```

### Alias nyasar ke grup atau room salah

Dari dalam WA CMD, hapus cache lokal yang jelas salah:

```txt
d 3
```

Atau dari terminal:

```bash
npm run cache:remove -- <jid-atau-index>
```

Lalu set alias ulang dari WA CMD:

```txt
/alias 1 matcha
```

## Batasan

- Belum menjamin sync semua history lama WhatsApp.
- Beberapa pesan lama/retry bisa gagal decrypt di Baileys.
- Belum support kirim gambar/file manual dari terminal.
- UI terminal bisa bergeser kalau pesan masuk tepat saat mengetik.
- Metadata nomor asli dari `@lid` tidak selalu tersedia dari Baileys.
- Ini bukan pengganti resmi WhatsApp Desktop.

## Roadmap ide

- Kirim gambar/file dari terminal.
- Fuzzy search yang lebih pintar untuk nama unicode/emoji.
- Export chat lokal.
- Multi-profile/multi-account lokal.
- Konfigurasi lewat file `.env` atau `config.json`.

## License

Gunakan secara bertanggung jawab untuk kebutuhan pribadi/eksperimen.

# Sensor Message

Fitur sensor message menyamarkan pesan lokal di WA CMD dengan gaya terminal setelah pesan ditandai sudah dilihat atau dibalas.

> Catatan: fitur ini hanya mengubah cache lokal WA CMD di `data/messages.json`. Pesan asli di WhatsApp tidak dihapus atau diedit.

## Cara pakai

Jalankan WA CMD seperti biasa, lalu aktifkan:

```txt
/sensor on
```

Cek status:

```txt
/sensor status
```

Matikan sensor untuk pesan berikutnya:

```txt
/sensor off
```

Paksa sensor untuk pesan lokal yang sudah ditandai:

```txt
/sensor now
```

## Perilaku

- Saat sensor ON, pesan di chat yang dibuka akan ditandai sebagai sudah dilihat.
- Saat kamu membalas chat, pesan lokal di chat tersebut juga ditandai.
- Lima menit setelah ditandai, teks di cache lokal akan berubah menjadi format seperti:

```txt
[░░ SENSOR ░░] ████████████
```

## Batasan

- Sensor bersifat lokal dan tidak memengaruhi pesan asli WhatsApp.
- Pesan yang sudah tersensor tidak bisa dikembalikan dari cache lokal, karena teks cache-nya diganti.
- Timer berjalan saat WA CMD aktif. Kalau app ditutup, pesan yang sudah lewat waktunya akan disensor saat app dibuka lagi.

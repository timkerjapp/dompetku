# 👛 Dompetku

Aplikasi web pencatatan dan pengelolaan keuangan pribadi.
Frontend statis (HTML/CSS/JavaScript) di **GitHub Pages**, backend **Supabase** (login + database PostgreSQL).

## Fitur

- Login/daftar dengan email & kata sandi (data tiap pengguna terpisah lewat Row Level Security)
- Catat pemasukan, pengeluaran, dan transfer antar-dompet
- **Ketik cepat**: tulis `makan siang 25rb kemarin` atau `gaji 5jt`, nominal/kategori/tanggal terisi otomatis
- Banyak dompet (Tunai, rekening bank, e-wallet) dengan saldo otomatis
- Ringkasan bulanan + grafik pengeluaran per kategori
- Anggaran bulanan per kategori dengan peringatan saat ≥ 80%
- Cari & filter transaksi, ekspor CSV per bulan
- Kelola kategori dan dompet; tampilan ramah HP dan mode gelap otomatis

## Struktur file

| File | Isi |
|---|---|
| `index.html` | Kerangka halaman |
| `style.css` | Tampilan |
| `app.js` | Logika aplikasi |
| `config.js` | URL & kunci Supabase (**wajib diisi**) |
| `schema.sql` | Tabel, keamanan (RLS), dan view saldo — dijalankan di Supabase |

---

## Langkah 1 — Siapkan Supabase

1. Buka <https://supabase.com>, buat akun, lalu **New project** (pilih region **Southeast Asia (Singapore)** agar cepat dari Indonesia).
2. Setelah proyek siap, buka **SQL Editor → New query**, tempel seluruh isi `schema.sql`, lalu klik **Run**.
3. Buka **Project Settings → API** (atau tombol **Connect**), salin:
   - **Project URL**
   - **anon public key** atau **publishable key**
4. Tempel keduanya ke `config.js`.

> Kunci anon/publishable memang dirancang untuk dipasang di frontend; data tetap aman karena dilindungi RLS.
> **Jangan** memasukkan `service_role` / secret key ke file mana pun di repo.

## Langkah 2 — Unggah ke GitHub & aktifkan GitHub Pages

1. Buat repository baru di GitHub, misalnya `dompetku` (boleh public).
2. Unggah kelima file (`index.html`, `style.css`, `app.js`, `config.js`, `schema.sql`) dan `README.md` ke root repo
   (**Add file → Upload files**, atau lewat `git push`).
3. Buka **Settings → Pages** → *Source*: **Deploy from a branch** → Branch: **main**, folder **/ (root)** → **Save**.
4. Tunggu 1–2 menit. Alamat aplikasi akan muncul, misalnya `https://namaanda.github.io/dompetku/`.

## Langkah 3 — Hubungkan alamat GitHub Pages ke Supabase

Agar tautan konfirmasi email mengarah ke aplikasi Anda:

1. Di Supabase buka **Authentication → URL Configuration**.
2. **Site URL**: isi alamat GitHub Pages Anda (mis. `https://namaanda.github.io/dompetku/`).
3. **Redirect URLs**: tambahkan alamat yang sama.

Selesai — buka alamat GitHub Pages, klik **Daftar**, konfirmasi email, lalu masuk.

> Untuk pemakaian sendiri dan ingin langsung bisa masuk tanpa konfirmasi email:
> **Authentication → Sign In / Providers → Email** → matikan *Confirm email*.

---

## Mencoba di komputer sendiri (opsional)

Karena memakai ES module, file **tidak bisa** dibuka langsung dengan klik dua kali (`file://`). Jalankan server lokal:

```bash
npx serve .
# atau
python -m http.server 8000
```

Lalu buka `http://localhost:8000` (tambahkan juga alamat ini di Redirect URLs Supabase bila perlu).
Di VS Code bisa juga memakai ekstensi **Live Server**.

## Contoh ketik cepat

| Ketikan | Hasil |
|---|---|
| `makan siang 25rb kemarin` | Pengeluaran Rp25.000 · Makan & Minum · tanggal kemarin |
| `bensin rp50.000` | Pengeluaran Rp50.000 · Transportasi |
| `token listrik 100rb` | Pengeluaran Rp100.000 · Tagihan |
| `gaji 5jt` | Pemasukan Rp5.000.000 · Gaji |
| `thr 2,5jt` | Pemasukan Rp2.500.000 · Bonus |

Satuan yang dikenali: `rb`/`ribu`/`k` (×1.000), `jt`/`juta` (×1.000.000). Kata kunci kategori bisa ditambah di `app.js` bagian `KEYWORDS`.

## Struktur database

- `wallets` — dompet + saldo awal
- `categories` — kategori pemasukan/pengeluaran
- `transactions` — transaksi (`income` / `expense` / `transfer`)
- `budgets` — batas bulanan per kategori
- `wallet_balances` (view) — saldo terkini tiap dompet

Kategori bawaan dan dompet "Tunai" dibuat otomatis saat pengguna pertama kali masuk.

## Ide pengembangan berikutnya

- Transaksi berulang (tagihan bulanan otomatis) + pengingat jatuh tempo
- Target tabungan dengan progress bar
- Catatan utang-piutang
- Jadikan PWA (bisa di-*install* di HP, ikon di layar utama)
- Scan struk (OCR) dan grafik tren beberapa bulan

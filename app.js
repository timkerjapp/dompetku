import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// =====================================================================
// Utilitas
// =====================================================================
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const rp = (n) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(n) || 0);
const fmtNum = (n) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(n) || 0);
const parseMoney = (s) => Number(String(s ?? '').replace(/\D/g, '')) || 0;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isoDate = (d) => d.toLocaleDateString('en-CA'); // YYYY-MM-DD (zona waktu lokal)
const today = () => isoDate(new Date());
const KIND = { income: 'Pemasukan', expense: 'Pengeluaran', transfer: 'Transfer' };

function monthRange(m) {
  const [y, mo] = m.split('-').map(Number);
  return [`${m}-01`, isoDate(new Date(y, mo, 1))]; // [awal bulan, awal bulan berikutnya)
}
function shiftMonth(m, delta) {
  const [y, mo] = m.split('-').map(Number);
  return isoDate(new Date(y, mo - 1 + delta, 1)).slice(0, 7);
}
const monthLabel = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
};
const fmtDate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });

function moneyInput(el) {
  el.addEventListener('input', () => {
    const n = parseMoney(el.value);
    el.value = n ? fmtNum(n) : '';
  });
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function translateErr(msg = '') {
  if (/invalid login credentials/i.test(msg)) return 'Email atau kata sandi salah.';
  if (/email not confirmed/i.test(msg)) return 'Email belum dikonfirmasi. Cek kotak masuk Anda.';
  if (/already registered/i.test(msg)) return 'Email sudah terdaftar. Silakan masuk.';
  if (/password should be at least/i.test(msg)) return 'Kata sandi minimal 6 karakter.';
  if (/rate limit/i.test(msg)) return 'Terlalu banyak percobaan. Coba lagi beberapa saat.';
  if (/failed to fetch/i.test(msg)) return 'Tidak dapat terhubung ke server. Periksa koneksi internet.';
  return msg;
}

// Menjalankan query Supabase dan melempar error bila gagal
async function q(builder) {
  const { data, error } = await builder;
  if (error) throw new Error(translateErr(error.message));
  return data;
}

// =====================================================================
// Inisialisasi Supabase
// =====================================================================
if (SUPABASE_URL.includes('YOUR-') || SUPABASE_ANON_KEY.includes('YOUR-')) {
  $('#loading').innerHTML = 'Konfigurasi belum diisi.<br><span class="small muted">Isi <code>SUPABASE_URL</code> dan <code>SUPABASE_ANON_KEY</code> di file <code>config.js</code>.</span>';
  throw new Error('config.js belum diisi');
}
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const state = {
  user: null,
  view: 'home',
  month: today().slice(0, 7),
  wallets: [],
  categories: [],
  budgets: [],
  txs: [],
};

const DEFAULT_CATEGORIES = [
  ['Makan & Minum', 'expense', '🍜'],
  ['Transportasi', 'expense', '🛵'],
  ['Belanja', 'expense', '🛒'],
  ['Tagihan', 'expense', '💡'],
  ['Kesehatan', 'expense', '💊'],
  ['Pendidikan', 'expense', '📚'],
  ['Hiburan', 'expense', '🎬'],
  ['Sedekah', 'expense', '🤲'],
  ['Lain-lain', 'expense', '📦'],
  ['Gaji', 'income', '💼'],
  ['Bonus', 'income', '🎁'],
  ['Usaha', 'income', '🏪'],
  ['Pemasukan Lain', 'income', '💰'],
];

// Kata kunci untuk fitur "ketik cepat"
const KEYWORDS = {
  'Makan & Minum': ['makan', 'minum', 'kopi', 'sarapan', 'nasi', 'jajan', 'bakso', 'mie', 'teh', 'snack', 'gofood', 'grabfood', 'lunch', 'dinner', 'gorengan', 'galon'],
  'Transportasi': ['bensin', 'pertalite', 'pertamax', 'parkir', 'ojek', 'ojol', 'grab', 'gojek', 'tol', 'kereta', 'krl', 'busway', 'bus', 'angkot', 'taksi', 'servis'],
  'Belanja': ['belanja', 'baju', 'sepatu', 'sabun', 'indomaret', 'alfamart', 'shopee', 'tokopedia', 'pasar', 'sayur'],
  'Tagihan': ['listrik', 'pln', 'token', 'pulsa', 'kuota', 'internet', 'wifi', 'indihome', 'pdam', 'bpjs', 'cicilan', 'kos', 'kontrakan', 'sewa', 'iuran'],
  'Kesehatan': ['obat', 'dokter', 'apotek', 'klinik', 'vitamin', 'rumah sakit'],
  'Pendidikan': ['buku', 'kursus', 'spp', 'sekolah', 'kuliah', 'les', 'seminar'],
  'Hiburan': ['nonton', 'bioskop', 'game', 'netflix', 'spotify', 'youtube', 'liburan', 'wisata'],
  'Sedekah': ['sedekah', 'infak', 'infaq', 'zakat', 'donasi', 'amal', 'kondangan'],
  'Gaji': ['gaji', 'honor', 'honorarium', 'tunjangan', 'upah'],
  'Bonus': ['bonus', 'thr', 'insentif'],
  'Usaha': ['jualan', 'usaha', 'omzet', 'penjualan', 'laba'],
};

const catById = (id) => state.categories.find((c) => c.id === id);
const catName = (id) => { const c = catById(id); return c ? `${c.icon} ${c.name}` : 'Tanpa kategori'; };
const walletName = (id) => state.wallets.find((w) => w.id === id)?.name ?? '(dompet terhapus)';

// =====================================================================
// Autentikasi
// =====================================================================
let signUpMode = false;
$('#auth-toggle').addEventListener('click', (e) => {
  e.preventDefault();
  signUpMode = !signUpMode;
  $('#auth-submit').textContent = signUpMode ? 'Daftar' : 'Masuk';
  $('#auth-toggle-text').textContent = signUpMode ? 'Sudah punya akun?' : 'Belum punya akun?';
  $('#auth-toggle').textContent = signUpMode ? 'Masuk' : 'Daftar';
  $('#auth-form [name=password]').autocomplete = signUpMode ? 'new-password' : 'current-password';
  $('#auth-msg').textContent = '';
});

$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const email = String(f.get('email')).trim();
  const password = String(f.get('password'));
  const msg = $('#auth-msg');
  const btn = $('#auth-submit');
  msg.className = 'small center';
  msg.textContent = 'Memproses…';
  btn.disabled = true;
  try {
    const { data, error } = signUpMode
      ? await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } })
      : await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    msg.textContent = signUpMode && !data.session
      ? 'Pendaftaran berhasil. Cek email Anda untuk konfirmasi, lalu masuk.'
      : '';
  } catch (err) {
    msg.className = 'small center error';
    msg.textContent = translateErr(err.message);
  } finally {
    btn.disabled = false;
  }
});

let currentUserId;
sb.auth.onAuthStateChange((event, session) => {
  const user = session?.user ?? null;
  const id = user?.id ?? null;
  if (id === currentUserId) return; // abaikan refresh token untuk pengguna yang sama
  currentUserId = id;
  setTimeout(() => setUser(user), 0); // hindari memanggil Supabase langsung di dalam callback
});

async function setUser(user) {
  state.user = user;
  $('#loading').classList.add('hidden');
  if (!user) {
    $('#app').classList.add('hidden');
    $('#auth').classList.remove('hidden');
    return;
  }
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#view').innerHTML = '<p class="muted center">Menyiapkan data…</p>';
  try {
    await loadRefs();
    await render();
  } catch (err) {
    $('#view').innerHTML = `<p class="error center">${esc(err.message)}</p><p class="small muted center">Pastikan <code>schema.sql</code> sudah dijalankan di Supabase.</p>`;
  }
}

// =====================================================================
// Data
// =====================================================================
const fetchWallets = () => q(sb.from('wallet_balances').select('*').order('created_at'));
const fetchCategories = () => q(sb.from('categories').select('*').order('name'));
const fetchBudgets = () => q(sb.from('budgets').select('*'));

async function loadRefs() {
  let [wallets, categories, budgets] = await Promise.all([fetchWallets(), fetchCategories(), fetchBudgets()]);

  // Pengguna baru: siapkan kategori dan dompet bawaan
  if (!categories.length) {
    await q(sb.from('categories').insert(DEFAULT_CATEGORIES.map(([name, kind, icon]) => ({ name, kind, icon }))));
    categories = await fetchCategories();
  }
  if (!wallets.length) {
    await q(sb.from('wallets').insert({ name: 'Tunai' }));
    wallets = await fetchWallets();
  }
  Object.assign(state, { wallets, categories, budgets });
}

async function loadMonthTx() {
  const [start, end] = monthRange(state.month);
  return q(
    sb.from('transactions').select('*')
      .gte('tx_date', start).lt('tx_date', end)
      .order('tx_date', { ascending: false })
      .order('created_at', { ascending: false })
  );
}

function sums(txs) {
  let inc = 0, exp = 0;
  const byCat = {};
  for (const t of txs) {
    const a = Number(t.amount);
    if (t.kind === 'income') inc += a;
    else if (t.kind === 'expense') {
      exp += a;
      const k = t.category_id ?? 'none';
      byCat[k] = (byCat[k] || 0) + a;
    }
  }
  return { inc, exp, byCat };
}

// =====================================================================
// Render
// =====================================================================
const TITLES = { home: 'Beranda', tx: 'Transaksi', budget: 'Anggaran', settings: 'Pengaturan' };
let renderSeq = 0;

async function render() {
  const seq = ++renderSeq;
  $('#title').textContent = TITLES[state.view];
  $('#month-label').textContent = monthLabel(state.month);
  $('.month-nav').classList.toggle('hidden', state.view === 'settings');
  $$('.bottom-nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  const v = $('#view');

  if (state.view === 'settings') return renderSettings(v);

  try {
    const txs = await loadMonthTx();
    if (seq !== renderSeq) return; // sudah ada render yang lebih baru
    state.txs = txs;
    ({ home: renderHome, tx: renderTx, budget: renderBudget })[state.view](v, txs);
  } catch (err) {
    if (seq === renderSeq) v.innerHTML = `<p class="error center">${esc(err.message)}</p>`;
  }
}

function bar(spent, total) {
  const ratio = total > 0 ? spent / total : 0;
  const cls = ratio >= 1 ? 'over' : ratio >= 0.8 ? 'warn' : '';
  return `<div class="bar ${cls}"><span style="width:${Math.min(100, ratio * 100).toFixed(1)}%"></span></div>`;
}

function txListHtml(txs) {
  let html = '', last = '';
  for (const t of txs) {
    if (t.tx_date !== last) {
      last = t.tx_date;
      html += `<div class="date-head">${fmtDate(t.tx_date)}</div>`;
    }
    const isT = t.kind === 'transfer';
    const title = isT ? `🔁 ${walletName(t.wallet_id)} → ${walletName(t.to_wallet_id)}` : catName(t.category_id);
    const sub = [t.note, isT ? '' : walletName(t.wallet_id)].filter(Boolean).join(' · ');
    const sign = t.kind === 'income' ? '+' : t.kind === 'expense' ? '−' : '';
    html += `<button class="tx-item" data-id="${t.id}">
      <div><div>${esc(title)}</div><div class="muted small">${esc(sub)}</div></div>
      <div class="amt ${t.kind}">${sign}${rp(t.amount)}</div>
    </button>`;
  }
  return html;
}

function bindTxList(root) {
  $$('.tx-item', root).forEach((b) => {
    b.addEventListener('click', () => openTx(state.txs.find((t) => t.id === b.dataset.id)));
  });
}

// ---------- Beranda ----------
let chart;
function renderHome(v, txs) {
  const total = state.wallets.reduce((s, w) => s + Number(w.balance), 0);
  const { inc, exp, byCat } = sums(txs);
  const catRows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const diff = inc - exp;

  const alerts = state.budgets
    .map((b) => ({ b, spent: byCat[b.category_id] || 0 }))
    .filter(({ b, spent }) => spent / Number(b.amount) >= 0.8)
    .sort((x, y) => y.spent / y.b.amount - x.spent / x.b.amount);

  v.innerHTML = `
    <div class="card hero">
      <div class="muted small">Saldo saat ini</div>
      <div class="big">${rp(total)}</div>
      <div class="wallet-chips">${state.wallets.map((w) => `<span class="chip">${esc(w.name)} · ${rp(w.balance)}</span>`).join('')}</div>
    </div>
    <div class="grid2">
      <div class="card"><div class="muted small">Pemasukan</div><div class="amt income">${rp(inc)}</div></div>
      <div class="card"><div class="muted small">Pengeluaran</div><div class="amt expense">${rp(exp)}</div></div>
    </div>
    <div class="card row">
      <div><div class="muted small">Selisih bulan ini</div><div class="amt ${diff >= 0 ? 'income' : 'expense'}">${diff >= 0 ? '+' : '−'}${rp(Math.abs(diff))}</div></div>
      <span class="spacer"></span>
      <div class="small muted">${inc > 0 ? `Tersisa ${Math.round((diff / inc) * 100)}% dari pemasukan` : ''}</div>
    </div>
    ${alerts.length ? `<div class="card"><h3>⚠️ Anggaran hampir habis</h3>${alerts.map(({ b, spent }) => `
      <div class="small"><strong>${esc(catName(b.category_id))}</strong> — ${rp(spent)} dari ${rp(b.amount)}</div>${bar(spent, b.amount)}`).join('')}</div>` : ''}
    <div class="card">
      <h3>Pengeluaran per kategori</h3>
      ${catRows.length ? '<div class="chart-box"><canvas id="cat-chart"></canvas></div>' : '<p class="muted small">Belum ada pengeluaran bulan ini.</p>'}
    </div>
    <div class="card">
      <h3>Transaksi terakhir</h3>
      ${txs.length ? txListHtml(txs.slice(0, 5)) : '<p class="muted small">Belum ada transaksi. Tekan tombol + untuk mulai mencatat.</p>'}
    </div>`;
  bindTxList(v);
  if (catRows.length) drawChart(catRows);
}

function drawChart(rows) {
  chart?.destroy();
  if (typeof Chart === 'undefined') return;
  const colors = ['#0f766e', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#f97316', '#64748b', '#14b8a6'];
  const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text').trim();
  chart = new Chart($('#cat-chart'), {
    type: 'doughnut',
    data: {
      labels: rows.map(([id]) => catName(id === 'none' ? null : id)),
      datasets: [{ data: rows.map((r) => r[1]), backgroundColor: rows.map((_, i) => colors[i % colors.length]), borderWidth: 0 }],
    },
    options: {
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: { position: 'bottom', labels: { color: textColor, boxWidth: 12, padding: 10 } },
        tooltip: { callbacks: { label: (c) => ` ${c.label}: ${rp(c.raw)}` } },
      },
    },
  });
}

// ---------- Transaksi ----------
function renderTx(v, txs) {
  v.innerHTML = `
    <div class="toolbar">
      <input id="search" type="search" placeholder="Cari catatan / kategori…">
      <select id="kind-filter">
        <option value="">Semua</option>
        <option value="expense">Pengeluaran</option>
        <option value="income">Pemasukan</option>
        <option value="transfer">Transfer</option>
      </select>
    </div>
    <div id="tx-container"></div>
    <button id="export" class="btn block">⬇️ Ekspor CSV bulan ini</button>`;

  const draw = () => {
    const s = $('#search').value.toLowerCase().trim();
    const k = $('#kind-filter').value;
    const f = txs.filter((t) => (!k || t.kind === k) &&
      (!s || `${t.note || ''} ${catName(t.category_id)} ${walletName(t.wallet_id)}`.toLowerCase().includes(s)));
    $('#tx-container').innerHTML = f.length ? txListHtml(f) : '<p class="muted center small">Tidak ada transaksi.</p>';
    bindTxList($('#tx-container'));
  };
  $('#search').addEventListener('input', draw);
  $('#kind-filter').addEventListener('change', draw);
  $('#export').addEventListener('click', () => exportCsv(txs));
  draw();
}

function exportCsv(txs) {
  if (!txs.length) return toast('Tidak ada transaksi untuk diekspor');
  const rows = [
    ['Tanggal', 'Jenis', 'Kategori', 'Dompet', 'Ke Dompet', 'Nominal', 'Catatan'],
    ...txs.map((t) => [
      t.tx_date, KIND[t.kind],
      t.kind === 'transfer' ? '' : (catById(t.category_id)?.name ?? ''),
      walletName(t.wallet_id), t.to_wallet_id ? walletName(t.to_wallet_id) : '',
      Number(t.amount), t.note ?? '',
    ]),
  ];
  const csv = rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `dompetku-${state.month}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Anggaran ----------
function renderBudget(v, txs) {
  const { byCat, exp } = sums(txs);
  const cats = state.categories.filter((c) => c.kind === 'expense');
  const budgetOf = (id) => state.budgets.find((b) => b.category_id === id);

  const info = (c) => {
    const b = budgetOf(c.id);
    const spent = byCat[c.id] || 0;
    if (!b) return spent ? `<div class="muted small">Terpakai ${rp(spent)}</div>` : '';
    const left = Number(b.amount) - spent;
    return `${bar(spent, b.amount)}<div class="muted small">Terpakai ${rp(spent)} · ${left >= 0 ? `Sisa ${rp(left)}` : `<span class="error">Lebih ${rp(-left)}</span>`}</div>`;
  };
  const summary = () => {
    const totalBudget = state.budgets.reduce((s, b) => s + Number(b.amount), 0);
    const budgetedSpent = state.budgets.reduce((s, b) => s + (byCat[b.category_id] || 0), 0);
    return totalBudget
      ? `<div class="muted small">Terpakai dari total anggaran</div><div class="amt">${rp(budgetedSpent)} / ${rp(totalBudget)}</div>${bar(budgetedSpent, totalBudget)}<div class="muted small">Total pengeluaran bulan ini: ${rp(exp)}</div>`
      : `<div class="muted small">Belum ada anggaran. Isi batas bulanan di kategori di bawah.</div><div class="muted small">Total pengeluaran bulan ini: ${rp(exp)}</div>`;
  };

  v.innerHTML = `
    <div class="card" id="budget-summary">${summary()}</div>
    <p class="muted small">Anggaran berlaku setiap bulan. Kosongkan isian untuk menghapus anggaran kategori.</p>
    ${cats.map((c) => `
      <div class="card budget-row">
        <div class="row">
          <strong>${esc(c.icon)} ${esc(c.name)}</strong>
          <span class="spacer"></span>
          <input class="budget-input" data-cat="${c.id}" inputmode="numeric" placeholder="Atur batas" value="${budgetOf(c.id) ? fmtNum(budgetOf(c.id).amount) : ''}">
        </div>
        <div class="budget-info" data-info="${c.id}">${info(c)}</div>
      </div>`).join('')}`;

  $$('.budget-input', v).forEach((inp) => {
    moneyInput(inp);
    inp.addEventListener('change', async () => {
      const catId = inp.dataset.cat;
      const amount = parseMoney(inp.value);
      try {
        if (!amount) {
          await q(sb.from('budgets').delete().eq('category_id', catId));
        } else {
          await q(sb.from('budgets').upsert({ user_id: state.user.id, category_id: catId, amount }, { onConflict: 'user_id,category_id' }));
        }
        state.budgets = await fetchBudgets();
        $(`[data-info="${catId}"]`, v).innerHTML = info(catById(catId));
        $('#budget-summary', v).innerHTML = summary();
        toast(amount ? 'Anggaran disimpan' : 'Anggaran dihapus');
      } catch (err) {
        toast(err.message);
      }
    });
  });
}

// ---------- Pengaturan ----------
function renderSettings(v) {
  v.innerHTML = `
    <div class="card">
      <h3>Dompet</h3>
      <div>${state.wallets.map((w) => `
        <div class="list-row">
          <span>${esc(w.name)}</span><span class="spacer"></span>
          <span class="small amt">${rp(w.balance)}</span>
          <button class="icon-btn" data-edit-wallet="${w.id}" title="Ubah" aria-label="Ubah ${esc(w.name)}">✏️</button>
          <button class="icon-btn" data-del-wallet="${w.id}" title="Hapus" aria-label="Hapus ${esc(w.name)}">🗑️</button>
        </div>`).join('')}</div>
      <form id="wallet-form" class="inline-form">
        <input name="name" placeholder="Nama (mis. BCA, GoPay)" required maxlength="40">
        <input name="initial" inputmode="numeric" placeholder="Saldo awal">
        <button class="btn primary">Tambah</button>
      </form>
    </div>

    <div class="card">
      <h3>Kategori</h3>
      ${['expense', 'income'].map((k) => `
        <div class="muted small">${KIND[k]}</div>
        <div class="chips">${state.categories.filter((c) => c.kind === k).map((c) => `
          <span class="chip">${esc(c.icon)} ${esc(c.name)}
            <button class="chip-x" data-del-cat="${c.id}" title="Hapus" aria-label="Hapus ${esc(c.name)}">×</button>
          </span>`).join('')}</div>`).join('')}
      <form id="cat-form" class="inline-form">
        <input name="icon" placeholder="🙂" maxlength="4" class="icon-input" aria-label="Ikon">
        <input name="name" placeholder="Nama kategori" required maxlength="40">
        <select name="kind"><option value="expense">Pengeluaran</option><option value="income">Pemasukan</option></select>
        <button class="btn primary">Tambah</button>
      </form>
    </div>

    <div class="card">
      <h3>Akun</h3>
      <p class="muted small">Masuk sebagai ${esc(state.user.email)}</p>
      <button id="logout" class="btn danger">Keluar</button>
    </div>`;

  moneyInput($('#wallet-form [name=initial]', v));

  $('#wallet-form', v).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await q(sb.from('wallets').insert({ name: String(f.get('name')).trim(), initial_balance: parseMoney(f.get('initial')) }));
      state.wallets = await fetchWallets();
      toast('Dompet ditambahkan');
      renderSettings(v);
    } catch (err) { toast(err.message); }
  });

  $$('[data-edit-wallet]', v).forEach((b) => b.addEventListener('click', async () => {
    const w = state.wallets.find((x) => x.id === b.dataset.editWallet);
    const name = prompt('Nama dompet:', w.name);
    if (name === null || !name.trim()) return;
    const initial = prompt('Saldo awal (Rp):', fmtNum(w.initial_balance));
    if (initial === null) return;
    try {
      await q(sb.from('wallets').update({ name: name.trim().slice(0, 40), initial_balance: parseMoney(initial) }).eq('id', w.id));
      state.wallets = await fetchWallets();
      toast('Dompet diperbarui');
      renderSettings(v);
    } catch (err) { toast(err.message); }
  }));

  $$('[data-del-wallet]', v).forEach((b) => b.addEventListener('click', async () => {
    if (state.wallets.length <= 1) return toast('Minimal harus ada satu dompet');
    const w = state.wallets.find((x) => x.id === b.dataset.delWallet);
    if (!confirm(`Hapus dompet "${w.name}"?\nSemua transaksi di dompet ini juga akan terhapus.`)) return;
    try {
      await q(sb.from('wallets').delete().eq('id', w.id));
      state.wallets = await fetchWallets();
      toast('Dompet dihapus');
      renderSettings(v);
    } catch (err) { toast(err.message); }
  }));

  $('#cat-form', v).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await q(sb.from('categories').insert({
        name: String(f.get('name')).trim(),
        kind: f.get('kind'),
        icon: String(f.get('icon')).trim() || '•',
      }));
      state.categories = await fetchCategories();
      toast('Kategori ditambahkan');
      renderSettings(v);
    } catch (err) { toast(err.message); }
  });

  $$('[data-del-cat]', v).forEach((b) => b.addEventListener('click', async () => {
    const c = catById(b.dataset.delCat);
    if (!confirm(`Hapus kategori "${c.name}"?\nTransaksi lama tetap ada, tetapi menjadi "Tanpa kategori".`)) return;
    try {
      await q(sb.from('categories').delete().eq('id', c.id));
      [state.categories, state.budgets] = await Promise.all([fetchCategories(), fetchBudgets()]);
      toast('Kategori dihapus');
      renderSettings(v);
    } catch (err) { toast(err.message); }
  }));

  $('#logout', v).addEventListener('click', async () => {
    if (!confirm('Keluar dari akun?')) return;
    await sb.auth.signOut();
  });
}

// =====================================================================
// Form transaksi
// =====================================================================
const dlg = $('#tx-dialog');
let editing = null;
let kind = 'expense';

function setKind(k) {
  kind = k;
  $$('#kind-seg button').forEach((b) => b.classList.toggle('active', b.dataset.kind === k));
  $('#cat-wrap').classList.toggle('hidden', k === 'transfer');
  $('#to-wrap').classList.toggle('hidden', k !== 'transfer');
  $('#wallet-label').textContent = k === 'transfer' ? 'Dari dompet' : 'Dompet';
  const cs = state.categories.filter((c) => c.kind === (k === 'income' ? 'income' : 'expense'));
  $('#category').innerHTML = cs.map((c) => `<option value="${c.id}">${esc(c.icon)} ${esc(c.name)}</option>`).join('');
}

function lastWallet() {
  try { return localStorage.getItem('dompetku:lastWallet'); } catch { return null; }
}
function rememberWallet(id) {
  try { localStorage.setItem('dompetku:lastWallet', id); } catch { /* abaikan */ }
}

function openTx(t = null) {
  editing = t;
  const opts = state.wallets.map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join('');
  $('#wallet').innerHTML = opts;
  $('#to-wallet').innerHTML = opts;

  setKind(t?.kind ?? 'expense');
  $('#tx-title').textContent = t ? 'Ubah transaksi' : 'Tambah transaksi';
  $('#quick-wrap').classList.toggle('hidden', !!t);
  $('#quick').value = '';
  $('#amount').value = t ? fmtNum(t.amount) : '';
  if (t?.category_id && catById(t.category_id)) $('#category').value = t.category_id;

  const lw = lastWallet();
  $('#wallet').value = t?.wallet_id ?? (state.wallets.some((w) => w.id === lw) ? lw : state.wallets[0]?.id);
  $('#to-wallet').value = t?.to_wallet_id ?? (state.wallets.find((w) => w.id !== $('#wallet').value)?.id ?? '');
  $('#date').value = t?.tx_date ?? today();
  $('#note').value = t?.note ?? '';
  $('#tx-delete').classList.toggle('hidden', !t);
  $('#tx-msg').textContent = '';
  $('#tx-save').disabled = false;

  dlg.showModal();
  if (!t) $('#quick').focus();
}

// --- Ketik cepat: "makan siang 25rb kemarin", "gaji 5jt", "bensin rp50.000"
function parseQuick(text) {
  let s = ' ' + text.toLowerCase() + ' ';
  const r = {};

  s = s.replace(/\brp\.?\s*/g, ' ');
  const m = s.match(/(\d[\d.,]*)\s*(rb|ribu|k|jt|juta)?(?![a-z])/);
  if (m) {
    const unit = m[2];
    let n;
    if (unit) {
      n = parseFloat(m[1].replace(',', '.'));
      n *= /^(jt|juta)$/.test(unit) ? 1e6 : 1e3;
    } else {
      n = parseFloat(m[1].replace(/[.,]/g, ''));
    }
    if (n > 0) r.amount = Math.round(n);
    s = s.replace(m[0], ' ');
  }

  if (/\bkemarin\b/.test(s)) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    r.date = isoDate(d);
    s = s.replace(/\bkemarin\b/, ' ');
  } else if (/\bhari ini\b/.test(s)) {
    r.date = today();
    s = s.replace(/\bhari ini\b/, ' ');
  }

  const words = s.split(/[^a-z0-9&]+/).filter(Boolean);
  const plain = ' ' + words.join(' ') + ' ';
  for (const c of state.categories) {
    const kws = [c.name.toLowerCase(), ...(KEYWORDS[c.name] || [])];
    if (kws.some((k) => plain.includes(' ' + k + ' '))) { r.category = c; break; }
  }

  const note = s.replace(/\s+/g, ' ').trim();
  if (note) r.note = note[0].toUpperCase() + note.slice(1);
  return r;
}

$('#quick').addEventListener('input', () => {
  const r = parseQuick($('#quick').value);
  if (r.category) {
    if (r.category.kind !== kind) setKind(r.category.kind);
    $('#category').value = r.category.id;
  }
  if (r.amount) $('#amount').value = fmtNum(r.amount);
  if (r.date) $('#date').value = r.date;
  $('#note').value = r.note || '';
});

$$('#kind-seg button').forEach((b) => b.addEventListener('click', () => setKind(b.dataset.kind)));
moneyInput($('#amount'));
$('#tx-cancel').addEventListener('click', () => dlg.close());
$('#fab').addEventListener('click', () => openTx());

const showTxErr = (msg) => { $('#tx-msg').textContent = msg; };

$('#tx-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const amount = parseMoney($('#amount').value);
  if (!amount) return showTxErr('Nominal harus diisi dan lebih dari 0.');
  if (!$('#date').value) return showTxErr('Tanggal harus diisi.');

  const row = {
    kind,
    amount,
    wallet_id: $('#wallet').value,
    to_wallet_id: kind === 'transfer' ? $('#to-wallet').value : null,
    category_id: kind === 'transfer' ? null : ($('#category').value || null),
    tx_date: $('#date').value,
    note: $('#note').value.trim() || null,
  };
  if (kind === 'transfer') {
    if (state.wallets.length < 2) return showTxErr('Tambahkan dompet kedua di menu Atur untuk melakukan transfer.');
    if (row.to_wallet_id === row.wallet_id) return showTxErr('Dompet asal dan tujuan harus berbeda.');
  }

  $('#tx-save').disabled = true;
  try {
    if (editing) await q(sb.from('transactions').update(row).eq('id', editing.id));
    else await q(sb.from('transactions').insert(row));
    rememberWallet(row.wallet_id);
    dlg.close();
    state.month = row.tx_date.slice(0, 7);
    state.wallets = await fetchWallets();
    await render();
    toast(editing ? 'Transaksi diperbarui' : 'Transaksi disimpan');
  } catch (err) {
    showTxErr(err.message);
    $('#tx-save').disabled = false;
  }
});

$('#tx-delete').addEventListener('click', async () => {
  if (!editing || !confirm('Hapus transaksi ini?')) return;
  try {
    await q(sb.from('transactions').delete().eq('id', editing.id));
    dlg.close();
    state.wallets = await fetchWallets();
    await render();
    toast('Transaksi dihapus');
  } catch (err) { showTxErr(err.message); }
});

// =====================================================================
// Navigasi
// =====================================================================
$$('.bottom-nav button').forEach((b) => b.addEventListener('click', () => {
  state.view = b.dataset.view;
  window.scrollTo(0, 0);
  render();
}));
$('#prev-month').addEventListener('click', () => { state.month = shiftMonth(state.month, -1); render(); });
$('#next-month').addEventListener('click', () => { state.month = shiftMonth(state.month, 1); render(); });

// Ekspor untuk pengujian
export { parseQuick, monthRange, shiftMonth };

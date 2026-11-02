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
const sum = (arr, f) => arr.reduce((s, x) => s + Number(f(x) || 0), 0);

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
const fmtShort = (d) => new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);
// Jumlah bulan menabung tersisa, termasuk bulan berjalan (Nov → Des = 2)
function monthsLeft(fromIso, toIso) {
  const [y1, m1] = fromIso.split('-').map(Number);
  const [y2, m2] = toIso.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1) + 1;
}

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
  planTab: 'budget', // budget | goals | bills
  debtTab: 'receivable', // receivable | payable | done
  month: today().slice(0, 7),
  wallets: [],
  categories: [],
  budgets: [],
  bills: [],
  goals: [],
  deposits: [],
  debts: [],
  payments: [],
  txs: [],
  extrasError: null, // diisi bila tabel v2 belum dibuat
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
  'Kesehatan': ['obat', 'dokter', 'apotek', 'klinik', 'vitamin'],
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
const walletOptions = () => state.wallets.map((w) => [w.id, w.name]);
const expenseCatOptions = () => state.categories.filter((c) => c.kind === 'expense').map((c) => [c.id, `${c.icon} ${c.name}`]);

function lastWallet() {
  let id = null;
  try { id = localStorage.getItem('dompetku:lastWallet'); } catch { /* abaikan */ }
  return state.wallets.some((w) => w.id === id) ? id : state.wallets[0]?.id;
}
function rememberWallet(id) {
  try { if (id) localStorage.setItem('dompetku:lastWallet', id); } catch { /* abaikan */ }
}

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
const FETCH = {
  wallets: () => q(sb.from('wallet_balances').select('*').order('created_at')),
  categories: () => q(sb.from('categories').select('*').order('name')),
  budgets: () => q(sb.from('budgets').select('*')),
  bills: () => q(sb.from('bills').select('*').order('due_day').order('name')),
  goals: () => q(sb.from('goals').select('*').order('created_at')),
  deposits: () => q(sb.from('goal_deposits').select('*').order('dep_date', { ascending: false }).order('created_at', { ascending: false })),
  debts: () => q(sb.from('debts').select('*').order('created_at', { ascending: false })),
  payments: () => q(sb.from('debt_payments').select('*').order('pay_date', { ascending: false }).order('created_at', { ascending: false })),
};
async function refresh(...keys) {
  const res = await Promise.all(keys.map((k) => FETCH[k]()));
  keys.forEach((k, i) => { state[k] = res[i]; });
}

async function loadRefs() {
  await refresh('wallets', 'categories', 'budgets');

  // Pengguna baru: siapkan kategori dan dompet bawaan
  if (!state.categories.length) {
    await q(sb.from('categories').insert(DEFAULT_CATEGORIES.map(([name, kind, icon]) => ({ name, kind, icon }))));
    await refresh('categories');
  }
  if (!state.wallets.length) {
    await q(sb.from('wallets').insert({ name: 'Tunai' }));
    await refresh('wallets');
  }

  // Tabel fitur v2 (tagihan, target, utang piutang)
  try {
    await refresh('bills', 'goals', 'deposits', 'debts', 'payments');
    state.extrasError = null;
  } catch (err) {
    state.extrasError = err.message;
  }
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

// ---------- Hitungan perencanaan ----------
const goalSaved = (id) => sum(state.deposits.filter((d) => d.goal_id === id), (d) => d.amount);
function goalMonthlyNeed(g) {
  const left = Number(g.target_amount) - goalSaved(g.id);
  if (left <= 0 || !g.target_date || g.target_date < today()) return 0;
  return Math.ceil(left / Math.max(1, monthsLeft(today(), g.target_date)));
}
function billDueDate(b, month) {
  const [y, mo] = month.split('-').map(Number);
  const dim = new Date(y, mo, 0).getDate();
  return `${month}-${String(Math.min(b.due_day, dim)).padStart(2, '0')}`;
}
const billPaidTx = (b, txs) => txs.find((t) => t.bill_id === b.id);

// ---------- Hitungan utang piutang ----------
const debtPaid = (id) => sum(state.payments.filter((p) => p.debt_id === id), (p) => p.amount);
const debtLeft = (d) => Number(d.amount) - debtPaid(d.id);
function dueText(d, left) {
  if (left <= 0) return '✅ Lunas';
  if (!d.due_date) return 'Tanpa jatuh tempo';
  const dd = daysBetween(today(), d.due_date);
  if (dd < 0) return `<span class="error">Terlambat ${-dd} hari (jatuh tempo ${fmtShort(d.due_date)})</span>`;
  if (dd === 0) return '<span class="warn-text">Jatuh tempo hari ini</span>';
  if (dd <= 7) return `<span class="warn-text">Jatuh tempo ${dd} hari lagi</span>`;
  return `Jatuh tempo ${fmtShort(d.due_date)}`;
}
function waPhone(raw) {
  let p = String(raw || '').replace(/\D/g, '');
  if (!p) return '';
  if (p.startsWith('0')) p = '62' + p.slice(1);
  else if (p.startsWith('8')) p = '62' + p;
  return p;
}
function waLink(d, left) {
  const msg = `Halo ${d.person}, semoga sehat selalu. Mau mengingatkan soal pinjaman sebesar ${rp(left)}`
    + (d.due_date ? ` yang jatuh tempo ${fmtShort(d.due_date)}` : '')
    + '. Terima kasih 🙏';
  return `https://wa.me/${waPhone(d.phone)}?text=${encodeURIComponent(msg)}`;
}

// =====================================================================
// Render
// =====================================================================
const TITLES = { home: 'Beranda', tx: 'Transaksi', plan: 'Rencana', debt: 'Utang Piutang', settings: 'Pengaturan' };
let renderSeq = 0;

async function render() {
  const seq = ++renderSeq;
  $('#title').textContent = TITLES[state.view];
  $('#month-label').textContent = monthLabel(state.month);
  const noMonth = state.view === 'settings' || state.view === 'debt' || (state.view === 'plan' && state.planTab === 'goals');
  $('.month-nav').classList.toggle('hidden', noMonth);
  $$('.bottom-nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  const v = $('#view');

  if (state.view === 'settings') return renderSettings(v);
  if (state.view === 'debt') return renderDebts(v);
  if (noMonth) return renderPlan(v, []);

  try {
    const txs = await loadMonthTx();
    if (seq !== renderSeq) return; // sudah ada render yang lebih baru
    state.txs = txs;
    ({ home: renderHome, tx: renderTx, plan: renderPlan })[state.view](v, txs);
  } catch (err) {
    if (seq === renderSeq) v.innerHTML = `<p class="error center">${esc(err.message)}</p>`;
  }
}

// positive = semakin penuh semakin baik (target, cicilan); selain itu = anggaran
function bar(value, total, positive = false) {
  const ratio = total > 0 ? value / total : 0;
  const cls = positive ? 'goal' : ratio >= 1 ? 'over' : ratio >= 0.8 ? 'warn' : '';
  return `<div class="bar ${cls}"><span style="width:${Math.max(0, Math.min(100, ratio * 100)).toFixed(1)}%"></span></div>`;
}

function extrasErrHtml() {
  return `<div class="card">
    <p class="error">Fitur ini membutuhkan tabel baru di database.</p>
    <p class="small muted">Jalankan ulang <code>schema.sql</code> versi terbaru di Supabase (SQL Editor → Run), lalu muat ulang halaman ini. Data lama tidak akan hilang.</p>
    <p class="small muted">Detail: ${esc(state.extrasError)}</p>
  </div>`;
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
    const sub = [t.bill_id ? '🧾 Tagihan rutin' : '', t.note, isT ? '' : walletName(t.wallet_id)].filter(Boolean).join(' · ');
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
function attentionItems(txs) {
  const items = [];
  const t = today();
  if (!state.extrasError) {
    if (state.month === t.slice(0, 7)) {
      for (const b of state.bills) {
        if (billPaidTx(b, txs)) continue;
        const dd = daysBetween(t, billDueDate(b, state.month));
        if (dd > 3) continue;
        items.push({
          ico: '🧾', late: dd < 0, attr: `data-pay-bill="${b.id}"`,
          text: `Bayar ${esc(b.name)} · ${rp(b.amount)}`,
          sub: dd < 0 ? `terlambat ${-dd} hari` : dd === 0 ? 'jatuh tempo hari ini' : `jatuh tempo ${dd} hari lagi`,
        });
      }
    }
    for (const d of state.debts) {
      const left = debtLeft(d);
      if (left <= 0 || !d.due_date) continue;
      const dd = daysBetween(t, d.due_date);
      if (dd > 7) continue;
      const isR = d.kind === 'receivable';
      items.push({
        ico: isR ? '📥' : '📤', late: dd < 0, attr: `data-open-debt="${d.id}"`,
        text: `${isR ? 'Tagih' : 'Bayar utang ke'} ${esc(d.person)} · ${rp(left)}`,
        sub: dd < 0 ? `terlambat ${-dd} hari` : dd === 0 ? 'jatuh tempo hari ini' : `jatuh tempo ${dd} hari lagi`,
      });
    }
  }
  return items.sort((a, b) => Number(b.late) - Number(a.late));
}

function bindActionButtons(root) {
  $$('[data-pay-bill]', root).forEach((b) => b.addEventListener('click', () => payBill(b.dataset.payBill)));
  $$('[data-open-debt]', root).forEach((b) => b.addEventListener('click', () => openDebt(state.debts.find((d) => d.id === b.dataset.openDebt))));
  $$('[data-open-tx]', root).forEach((b) => b.addEventListener('click', () => openTx(state.txs.find((t) => t.id === b.dataset.openTx))));
}

let chart;
function renderHome(v, txs) {
  const total = sum(state.wallets, (w) => w.balance);
  const { inc, exp, byCat } = sums(txs);
  const catRows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const diff = inc - exp;
  const attn = attentionItems(txs);

  const alerts = state.budgets
    .map((b) => ({ b, spent: byCat[b.category_id] || 0 }))
    .filter(({ b, spent }) => spent / Number(b.amount) >= 0.8)
    .sort((x, y) => y.spent / y.b.amount - x.spent / x.b.amount);

  const openDebts = state.debts.map((d) => ({ d, left: debtLeft(d) })).filter((x) => x.left > 0);
  const recv = sum(openDebts.filter((x) => x.d.kind === 'receivable'), (x) => x.left);
  const pay = sum(openDebts.filter((x) => x.d.kind === 'payable'), (x) => x.left);

  v.innerHTML = `
    <div class="card hero">
      <div class="muted small">Saldo saat ini</div>
      <div class="big">${rp(total)}</div>
      <div class="wallet-chips">${state.wallets.map((w) => `<span class="chip">${esc(w.name)} · ${rp(w.balance)}</span>`).join('')}</div>
    </div>
    ${attn.length ? `<div class="card"><h3>🔔 Perlu perhatian</h3>${attn.map((a) => `
      <button class="attn-item" ${a.attr}><span class="ico">${a.ico}</span>
        <span class="grow"><span>${a.text}</span><br><span class="small ${a.late ? 'error' : 'warn-text'}">${a.sub}</span></span>›</button>`).join('')}</div>` : ''}
    <div class="grid2">
      <div class="card"><div class="muted small">Pemasukan</div><div class="amt income">${rp(inc)}</div></div>
      <div class="card"><div class="muted small">Pengeluaran</div><div class="amt expense">${rp(exp)}</div></div>
    </div>
    <div class="card row">
      <div><div class="muted small">Selisih bulan ini</div><div class="amt ${diff >= 0 ? 'income' : 'expense'}">${diff >= 0 ? '+' : '−'}${rp(Math.abs(diff))}</div></div>
      <span class="spacer"></span>
      <div class="small muted">${inc > 0 ? `Tersisa ${Math.round((diff / inc) * 100)}% dari pemasukan` : ''}</div>
    </div>
    ${recv || pay ? `<div class="grid2">
      <div class="card"><div class="muted small">Piutang belum kembali</div><div class="amt income">${rp(recv)}</div></div>
      <div class="card"><div class="muted small">Utang belum lunas</div><div class="amt expense">${rp(pay)}</div></div>
    </div>` : ''}
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
  bindActionButtons(v);
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
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `dompetku-${state.month}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// =====================================================================
// Rencana: Anggaran · Target tabungan · Tagihan rutin
// =====================================================================
function renderPlan(v, txs) {
  const tabs = [['budget', 'Anggaran'], ['goals', 'Target'], ['bills', 'Tagihan']];
  v.innerHTML = `
    <div class="seg tabs" id="plan-tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${state.planTab === k ? 'active' : ''}">${l}</button>`).join('')}</div>
    <div id="plan-body"></div>`;
  $$('#plan-tabs button', v).forEach((b) => b.addEventListener('click', () => { state.planTab = b.dataset.tab; render(); }));
  const body = $('#plan-body', v);
  if (state.planTab === 'budget') return renderBudget(body, txs);
  if (state.extrasError) { body.innerHTML = extrasErrHtml(); return; }
  if (state.planTab === 'goals') return renderGoals(body);
  return renderBills(body, txs);
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
    const totalBudget = sum(state.budgets, (b) => b.amount);
    const budgetedSpent = sum(state.budgets, (b) => byCat[b.category_id] || 0);
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
        await refresh('budgets');
        $(`[data-info="${catId}"]`, v).innerHTML = info(catById(catId));
        $('#budget-summary', v).innerHTML = summary();
        toast(amount ? 'Anggaran disimpan' : 'Anggaran dihapus');
      } catch (err) {
        toast(err.message);
      }
    });
  });
}

// ---------- Target tabungan ----------
function goalCardHtml(g) {
  const saved = goalSaved(g.id);
  const target = Number(g.target_amount);
  const left = Math.max(0, target - saved);
  let plan;
  if (saved >= target) plan = '🎉 Target tercapai!';
  else if (g.target_date && g.target_date < today()) plan = `<span class="error">Lewat tenggat ${fmtShort(g.target_date)}</span> · kurang ${rp(left)}`;
  else if (g.target_date) {
    const m = Math.max(1, monthsLeft(today(), g.target_date));
    plan = `Sisihkan <strong>${rp(goalMonthlyNeed(g))}/bulan</strong> selama ${m} bulan · tenggat ${fmtShort(g.target_date)}`;
  } else plan = `Kurang ${rp(left)} · tanpa tenggat`;
  return `
    <button class="card" data-goal="${g.id}">
      <div class="row"><strong>${esc(g.icon)} ${esc(g.name)}</strong><span class="spacer"></span><span class="small muted">${Math.min(100, Math.floor((saved / target) * 100))}%</span></div>
      ${bar(saved, target, true)}
      <div class="small"><span class="amt">${rp(saved)}</span> <span class="muted">dari ${rp(target)}</span></div>
      <div class="muted small">${plan}</div>
    </button>`;
}

function renderGoals(v) {
  const totalT = sum(state.goals, (g) => g.target_amount);
  const totalS = sum(state.goals, (g) => Math.min(goalSaved(g.id), Number(g.target_amount)));
  const monthly = sum(state.goals, goalMonthlyNeed);
  v.innerHTML = `
    ${state.goals.length ? `<div class="card">
      <div class="muted small">Total terkumpul</div>
      <div class="amt">${rp(totalS)} / ${rp(totalT)}</div>${bar(totalS, totalT, true)}
      ${monthly ? `<div class="small">Perlu disisihkan bulan ini: <strong>${rp(monthly)}</strong></div>` : ''}
    </div>` : ''}
    ${state.goals.length ? state.goals.map(goalCardHtml).join('') : '<p class="muted center small">Belum ada target tabungan.<br>Contoh: Dana darurat, DP rumah, Umrah, Laptop baru.</p>'}
    <button class="btn primary block" id="add-goal">+ Target baru</button>
    <p class="muted small">Setoran target mencatat progres tabungan dan tidak mengubah saldo dompet. Agar saldo tabungan terpisah, buat dompet “Tabungan” lalu gunakan Transfer.</p>`;
  $('#add-goal', v).addEventListener('click', () => goalForm());
  $$('[data-goal]', v).forEach((b) => b.addEventListener('click', () => openGoal(state.goals.find((g) => g.id === b.dataset.goal))));
}

function goalForm(g = null) {
  formDialog({
    title: g ? 'Ubah target' : 'Target tabungan baru',
    values: g ?? {},
    fields: [
      { name: 'icon', label: 'Ikon', default: '🎯', maxlength: 4 },
      { name: 'name', label: 'Nama target', required: true, maxlength: 60, placeholder: 'mis. Dana darurat' },
      { name: 'target_amount', label: 'Jumlah target (Rp)', type: 'money', required: true },
      { name: 'target_date', label: 'Tenggat (opsional)', type: 'date', hint: 'Diisi agar aplikasi menghitung berapa yang perlu disisihkan per bulan.' },
    ],
    onSubmit: async (data) => {
      data.icon = data.icon || '🎯';
      if (g) await q(sb.from('goals').update(data).eq('id', g.id));
      else await q(sb.from('goals').insert(data));
      await refresh('goals');
      toast('Target disimpan');
    },
    onDelete: g ? async () => {
      await q(sb.from('goals').delete().eq('id', g.id));
      await refresh('goals', 'deposits');
      toast('Target dihapus');
    } : null,
    onDone: () => render(),
  });
}

function openGoal(g) {
  if (!g) return;
  const deps = state.deposits.filter((d) => d.goal_id === g.id);
  const saved = goalSaved(g.id);
  openGen(`
    <h2>${esc(g.icon)} ${esc(g.name)}</h2>
    ${bar(saved, g.target_amount, true)}
    <div class="row small"><span>Terkumpul <strong>${rp(saved)}</strong></span><span class="spacer"></span><span>Target <strong>${rp(g.target_amount)}</strong></span></div>
    ${g.target_date ? `<div class="small muted">Tenggat ${fmtShort(g.target_date)}${goalMonthlyNeed(g) ? ` · perlu ${rp(goalMonthlyNeed(g))}/bulan` : ''}</div>` : ''}
    <h3 style="margin-top:1rem">Riwayat</h3>
    ${deps.length ? deps.map((d) => `
      <div class="list-row">
        <span class="small">${fmtShort(d.dep_date)}</span>
        <span class="muted small grow">${esc(d.note || '')}</span>
        <span class="amt ${Number(d.amount) >= 0 ? 'income' : 'expense'}">${Number(d.amount) >= 0 ? '+' : '−'}${rp(Math.abs(d.amount))}</span>
        <button class="icon-btn" data-del-dep="${d.id}" aria-label="Hapus">🗑️</button>
      </div>`).join('') : '<p class="muted small">Belum ada setoran.</p>'}
    <div class="stack">
      <div class="grid2" style="gap:.5rem">
        <button class="btn primary" id="dep-in">＋ Setor</button>
        <button class="btn" id="dep-out" ${saved > 0 ? '' : 'disabled'}>− Tarik</button>
      </div>
      <div class="row"><button class="btn" id="edit-goal">Ubah / hapus target</button><span class="spacer"></span><button class="btn" data-close>Tutup</button></div>
    </div>`, (root) => {
    $('#dep-in', root).addEventListener('click', () => depositForm(g, 1));
    $('#dep-out', root).addEventListener('click', () => depositForm(g, -1));
    $('#edit-goal', root).addEventListener('click', () => goalForm(g));
    $$('[data-del-dep]', root).forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Hapus catatan setoran ini?')) return;
      try {
        await q(sb.from('goal_deposits').delete().eq('id', b.dataset.delDep));
        await refresh('deposits');
        openGoal(g);
        render();
      } catch (err) { toast(err.message); }
    }));
  });
}

function depositForm(g, sign) {
  const saved = goalSaved(g.id);
  const left = Math.max(0, Number(g.target_amount) - saved);
  formDialog({
    title: sign > 0 ? `Setor ke ${g.name}` : `Tarik dari ${g.name}`,
    values: { amount: sign > 0 ? (goalMonthlyNeed(g) || left || '') : '' },
    fields: [
      { name: 'amount', label: 'Jumlah (Rp)', type: 'money', required: true },
      { name: 'dep_date', label: 'Tanggal', type: 'date', required: true, default: today() },
      { name: 'note', label: 'Catatan', maxlength: 200 },
    ],
    submitLabel: sign > 0 ? 'Setor' : 'Tarik',
    onSubmit: async (data) => {
      if (sign < 0 && data.amount > saved) throw new Error(`Penarikan melebihi saldo target (${rp(saved)}).`);
      await q(sb.from('goal_deposits').insert({ goal_id: g.id, amount: sign * data.amount, dep_date: data.dep_date, note: data.note }));
      await refresh('deposits');
      toast(sign > 0 ? 'Setoran dicatat' : 'Penarikan dicatat');
    },
    onDone: () => { openGoal(g); render(); },
  });
}

// ---------- Tagihan rutin + rencana arus kas ----------
function renderBills(v, txs) {
  const t = today();
  const rows = state.bills.map((b) => ({ b, paid: billPaidTx(b, txs), due: billDueDate(b, state.month) }));
  const total = sum(state.bills, (b) => b.amount);
  const paidTotal = sum(rows.filter((r) => r.paid), (r) => r.paid.amount);
  const { inc } = sums(txs);
  const goalsMonthly = sum(state.goals, goalMonthlyNeed);
  const free = inc - total - goalsMonthly;

  const status = ({ paid, due }) => {
    if (paid) return `Dibayar ${fmtShort(paid.tx_date)}`;
    const dd = daysBetween(t, due);
    if (dd < 0) return `<span class="error">Terlambat ${-dd} hari</span>`;
    if (dd === 0) return '<span class="warn-text">Jatuh tempo hari ini</span>';
    if (dd <= 3) return `<span class="warn-text">${dd} hari lagi</span>`;
    return `Jatuh tempo ${fmtShort(due)}`;
  };

  v.innerHTML = `
    <div class="card">
      <h3>Rencana arus kas ${esc(monthLabel(state.month))}</h3>
      <div class="flow-row"><span>Pemasukan tercatat</span><span class="amt income">${rp(inc)}</span></div>
      <div class="flow-row"><span>Tagihan rutin</span><span class="amt expense">−${rp(total)}</span></div>
      <div class="flow-row"><span>Sisihkan untuk target tabungan</span><span class="amt expense">−${rp(goalsMonthly)}</span></div>
      <div class="flow-row total"><span>Sisa untuk kebutuhan lain</span><span class="amt ${free >= 0 ? 'income' : 'expense'}">${free < 0 ? '−' : ''}${rp(Math.abs(free))}</span></div>
      ${inc === 0 ? '<p class="muted small">Catat pemasukan bulan ini (mis. gaji) agar rencana terlihat.</p>' : free < 0 ? '<p class="small error">Pemasukan belum cukup menutup tagihan dan target. Pertimbangkan menunda tenggat target atau mengurangi pengeluaran.</p>' : ''}
    </div>
    <div class="card">
      <div class="row"><h3 style="margin:0">Tagihan rutin</h3><span class="spacer"></span><span class="small muted">${rp(paidTotal)} / ${rp(total)} dibayar</span></div>
      ${total ? bar(paidTotal, total, true) : ''}
      ${rows.length ? rows.map((r) => `
        <div class="list-row">
          <div class="grow">
            <div><strong>${esc(r.b.name)}</strong> <span class="amt small">${rp(r.b.amount)}</span></div>
            <div class="muted small">Tiap tgl ${r.b.due_day}${r.b.category_id ? ` · ${esc(catName(r.b.category_id))}` : ''} · ${status(r)}</div>
          </div>
          ${r.paid ? `<button class="badge" data-open-tx="${r.paid.id}">✓ Lunas</button>` : `<button class="btn primary sm" data-pay-bill="${r.b.id}">Bayar</button>`}
          <button class="icon-btn" data-edit-bill="${r.b.id}" aria-label="Ubah">✏️</button>
        </div>`).join('') : '<p class="muted small">Belum ada tagihan rutin. Contoh: listrik, internet, cicilan, BPJS, uang sekolah.</p>'}
    </div>
    <button class="btn primary block" id="add-bill">+ Tagihan rutin</button>
    <p class="muted small">Tombol “Bayar” mencatat pengeluaran sekaligus menandai tagihan lunas untuk bulan tersebut.</p>`;

  bindActionButtons(v);
  $('#add-bill', v).addEventListener('click', () => billForm());
  $$('[data-edit-bill]', v).forEach((b) => b.addEventListener('click', () => billForm(state.bills.find((x) => x.id === b.dataset.editBill))));
}

function billForm(b = null) {
  const tagihan = state.categories.find((c) => c.kind === 'expense' && c.name === 'Tagihan');
  formDialog({
    title: b ? 'Ubah tagihan' : 'Tagihan rutin baru',
    values: b ?? {},
    fields: [
      { name: 'name', label: 'Nama tagihan', required: true, maxlength: 60, placeholder: 'mis. Listrik PLN' },
      { name: 'amount', label: 'Perkiraan nominal (Rp)', type: 'money', required: true },
      { name: 'due_day', label: 'Jatuh tempo tiap tanggal', type: 'number', required: true, min: 1, max: 31, default: 10 },
      { name: 'category_id', label: 'Kategori', type: 'select', options: [['', '— Tanpa kategori —'], ...expenseCatOptions()], default: tagihan?.id ?? '' },
      { name: 'wallet_id', label: 'Dibayar dari dompet', type: 'select', options: walletOptions(), default: lastWallet() },
    ],
    onSubmit: async (data) => {
      if (!Number.isInteger(data.due_day) || data.due_day < 1 || data.due_day > 31) throw new Error('Tanggal jatuh tempo harus 1–31.');
      if (b) await q(sb.from('bills').update(data).eq('id', b.id));
      else await q(sb.from('bills').insert(data));
      await refresh('bills');
      toast('Tagihan disimpan');
    },
    onDelete: b ? async () => {
      await q(sb.from('bills').delete().eq('id', b.id));
      await refresh('bills');
      toast('Tagihan dihapus');
    } : null,
    onDone: () => render(),
  });
}

function payBill(id) {
  const b = state.bills.find((x) => x.id === id);
  if (!b) return;
  const isCurrent = state.month === today().slice(0, 7);
  openTx(null, {
    kind: 'expense',
    amount: b.amount,
    category_id: b.category_id,
    wallet_id: b.wallet_id,
    note: b.name,
    bill_id: b.id,
    tx_date: isCurrent ? today() : billDueDate(b, state.month),
  });
}

// =====================================================================
// Utang Piutang
// =====================================================================
function renderDebts(v) {
  if (state.extrasError) { v.innerHTML = extrasErrHtml(); return; }
  const all = state.debts.map((d) => ({ d, paid: debtPaid(d.id) })).map((x) => ({ ...x, left: Number(x.d.amount) - x.paid }));
  const open = all.filter((x) => x.left > 0);
  const leftOf = (k) => sum(open.filter((x) => x.d.kind === k), (x) => x.left);

  const tabs = [['receivable', 'Piutang'], ['payable', 'Utang saya'], ['done', 'Lunas']];
  let list = state.debtTab === 'done'
    ? all.filter((x) => x.left <= 0)
    : open.filter((x) => x.d.kind === state.debtTab);
  if (state.debtTab !== 'done') {
    list = list.sort((a, b) => (a.d.due_date ?? '9999') .localeCompare(b.d.due_date ?? '9999'));
  }

  v.innerHTML = `
    <div class="grid2">
      <div class="card"><div class="muted small">Piutang (orang berutang ke saya)</div><div class="amt income">${rp(leftOf('receivable'))}</div></div>
      <div class="card"><div class="muted small">Utang saya</div><div class="amt expense">${rp(leftOf('payable'))}</div></div>
    </div>
    <div class="seg tabs" id="debt-tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${state.debtTab === k ? 'active' : ''}">${l}</button>`).join('')}</div>
    ${list.length ? list.map(({ d, paid, left }) => `
      <button class="card" data-open-debt="${d.id}">
        <div class="row">
          <strong>${d.kind === 'receivable' ? '📥' : '📤'} ${esc(d.person)}</strong><span class="spacer"></span>
          <span class="amt ${left <= 0 ? '' : d.kind === 'receivable' ? 'income' : 'expense'}">${rp(Math.max(0, left))}</span>
        </div>
        ${bar(paid, d.amount, true)}
        <div class="muted small">${[d.note ? esc(d.note) : '', `Dibayar ${rp(paid)} dari ${rp(d.amount)}`].filter(Boolean).join(' · ')}</div>
        <div class="small">${dueText(d, left)}</div>
      </button>`).join('') : `<p class="muted center small">${state.debtTab === 'done' ? 'Belum ada yang lunas.' : 'Tidak ada catatan.'}</p>`}
    <button class="btn primary block" id="add-debt">+ Catat utang / piutang</button>
    <p class="muted small">Jika dompet dipilih saat mencatat, saldo dompet ikut berubah: meminjamkan uang mengurangi saldo, menerima pinjaman menambah saldo, begitu pula pembayarannya.</p>`;

  $$('#debt-tabs button', v).forEach((b) => b.addEventListener('click', () => { state.debtTab = b.dataset.tab; render(); }));
  bindActionButtons(v);
  $('#add-debt', v).addEventListener('click', () => debtForm());
}

function debtForm(d = null) {
  const paid = d ? debtPaid(d.id) : 0;
  formDialog({
    title: d ? 'Ubah catatan' : 'Catat utang / piutang',
    values: d ?? {},
    fields: [
      { name: 'kind', label: 'Jenis', type: 'select', default: state.debtTab === 'payable' ? 'payable' : 'receivable',
        options: [['receivable', 'Piutang — saya meminjamkan uang'], ['payable', 'Utang — saya meminjam uang']] },
      { name: 'person', label: 'Nama orang', required: true, maxlength: 60 },
      { name: 'amount', label: 'Jumlah pinjaman (Rp)', type: 'money', required: true },
      { name: 'start_date', label: 'Tanggal pinjam', type: 'date', required: true, default: today() },
      { name: 'due_date', label: 'Jatuh tempo (opsional)', type: 'date' },
      { name: 'wallet_id', label: 'Dompet', type: 'select', default: d ? '' : lastWallet(),
        options: [['', '— Tidak memengaruhi saldo —'], ...walletOptions()],
        hint: 'Jika dipilih, saldo dompet ikut berubah.' },
      { name: 'phone', label: 'No. WhatsApp (opsional)', type: 'tel', maxlength: 20, placeholder: '08…', hint: 'Untuk tombol pengingat via WhatsApp.' },
      { name: 'note', label: 'Catatan', maxlength: 200, placeholder: 'mis. untuk biaya servis motor' },
    ],
    onSubmit: async (data) => {
      if (d && data.amount < paid) throw new Error(`Jumlah tidak boleh kurang dari yang sudah dibayar (${rp(paid)}).`);
      if (data.due_date && data.due_date < data.start_date) throw new Error('Jatuh tempo tidak boleh sebelum tanggal pinjam.');
      if (d) await q(sb.from('debts').update(data).eq('id', d.id));
      else await q(sb.from('debts').insert(data));
      rememberWallet(data.wallet_id);
      await refresh('debts', 'wallets');
      state.debtTab = data.kind;
      toast('Catatan disimpan');
    },
    onDelete: d ? async () => {
      await q(sb.from('debts').delete().eq('id', d.id));
      await refresh('debts', 'payments', 'wallets');
      toast('Catatan dihapus');
    } : null,
    onDone: () => render(),
  });
}

function openDebt(d) {
  if (!d) return;
  const pays = state.payments.filter((p) => p.debt_id === d.id);
  const paid = debtPaid(d.id);
  const left = Number(d.amount) - paid;
  const isR = d.kind === 'receivable';
  openGen(`
    <h2>${isR ? '📥 Piutang' : '📤 Utang'} · ${esc(d.person)}</h2>
    <div class="muted small">${isR ? 'Dipinjamkan' : 'Dipinjam'} ${rp(d.amount)} pada ${fmtShort(d.start_date)}${d.wallet_id ? ` · dompet ${esc(walletName(d.wallet_id))}` : ''}</div>
    ${d.note ? `<p class="small">${esc(d.note)}</p>` : ''}
    ${bar(paid, d.amount, true)}
    <div class="row small"><span>Dibayar <strong>${rp(paid)}</strong></span><span class="spacer"></span><span>Sisa <strong class="amt ${isR ? 'income' : 'expense'}">${rp(Math.max(0, left))}</strong></span></div>
    <div class="small">${dueText(d, left)}</div>
    <h3 style="margin-top:1rem">Riwayat pembayaran</h3>
    ${pays.length ? pays.map((p) => `
      <div class="list-row">
        <span class="small">${fmtShort(p.pay_date)}</span>
        <span class="muted small grow">${esc([p.note, p.wallet_id ? walletName(p.wallet_id) : ''].filter(Boolean).join(' · '))}</span>
        <span class="amt">${rp(p.amount)}</span>
        <button class="icon-btn" data-del-pay="${p.id}" aria-label="Hapus pembayaran">🗑️</button>
      </div>`).join('') : '<p class="muted small">Belum ada pembayaran.</p>'}
    <div class="stack">
      ${left > 0 ? `<button class="btn primary block" id="add-pay">${isR ? 'Terima pembayaran' : 'Bayar cicilan'}</button>` : ''}
      ${isR && left > 0 ? `<a class="btn block" href="${waLink(d, left)}" target="_blank" rel="noopener">💬 Ingatkan via WhatsApp</a>` : ''}
      <div class="row"><button class="btn" id="edit-debt">Ubah / hapus</button><span class="spacer"></span><button class="btn" data-close>Tutup</button></div>
    </div>`, (root) => {
    $('#add-pay', root)?.addEventListener('click', () => paymentForm(d));
    $('#edit-debt', root).addEventListener('click', () => debtForm(d));
    $$('[data-del-pay]', root).forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Hapus catatan pembayaran ini?')) return;
      try {
        await q(sb.from('debt_payments').delete().eq('id', b.dataset.delPay));
        await refresh('payments', 'wallets');
        openDebt(d);
        render();
      } catch (err) { toast(err.message); }
    }));
  });
}

function paymentForm(d) {
  const left = debtLeft(d);
  const isR = d.kind === 'receivable';
  formDialog({
    title: isR ? `Terima pembayaran dari ${d.person}` : `Bayar ke ${d.person}`,
    intro: `<p class="small muted">Sisa ${rp(left)}</p>`,
    values: { amount: left, wallet_id: d.wallet_id ?? '' },
    fields: [
      { name: 'amount', label: 'Jumlah (Rp)', type: 'money', required: true },
      { name: 'pay_date', label: 'Tanggal', type: 'date', required: true, default: today() },
      { name: 'wallet_id', label: isR ? 'Masuk ke dompet' : 'Dibayar dari dompet', type: 'select',
        options: [['', '— Tidak memengaruhi saldo —'], ...walletOptions()] },
      { name: 'note', label: 'Catatan', maxlength: 200 },
    ],
    submitLabel: 'Simpan pembayaran',
    onSubmit: async (data) => {
      if (data.amount > left) throw new Error(`Melebihi sisa ${rp(left)}.`);
      await q(sb.from('debt_payments').insert({ ...data, debt_id: d.id }));
      await refresh('payments', 'wallets');
      toast(data.amount === left ? 'Lunas! 🎉' : 'Pembayaran dicatat');
    },
    onDone: () => { openDebt(d); render(); },
  });
}

// =====================================================================
// Dialog umum (dipakai target, tagihan, utang piutang)
// =====================================================================
const gen = $('#gen-dialog');
function openGen(html, bind) {
  $('#gen-body').innerHTML = html;
  bind?.($('#gen-body'));
  if (!gen.open) gen.showModal();
}
gen.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) gen.close(); });

function formDialog({ title, fields, values = {}, intro = '', submitLabel = 'Simpan', onSubmit, onDelete = null, onDone }) {
  const fieldHtml = (f) => {
    const v = values[f.name] ?? f.default ?? '';
    const req = f.required ? 'required' : '';
    let input;
    if (f.type === 'select') {
      input = `<select name="${f.name}">${f.options.map(([val, lab]) => `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
    } else if (f.type === 'money') {
      input = `<input name="${f.name}" inputmode="numeric" data-money autocomplete="off" value="${v !== '' && v != null ? fmtNum(v) : ''}" placeholder="0" ${req}>`;
    } else {
      input = `<input name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}" autocomplete="off"
        ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} ${f.maxlength ? `maxlength="${f.maxlength}"` : ''} ${req}>`;
    }
    return `<label>${esc(f.label)}${input}${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}</label>`;
  };

  openGen(`
    <form id="gen-form" novalidate>
      <h2>${esc(title)}</h2>
      ${intro}
      ${fields.map(fieldHtml).join('')}
      <p class="small error" id="gen-msg"></p>
      <div class="row">
        ${onDelete ? '<button type="button" class="btn danger" id="gen-del">Hapus</button>' : ''}
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>Batal</button>
        <button type="submit" class="btn primary" id="gen-save">${esc(submitLabel)}</button>
      </div>
    </form>`, (root) => {
    $$('[data-money]', root).forEach(moneyInput);
    const form = $('#gen-form', root);
    const err = (m) => { $('#gen-msg', root).textContent = m; };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = {};
      for (const f of fields) {
        const raw = form.querySelector(`[name="${f.name}"]`).value;
        if (f.type === 'money') data[f.name] = parseMoney(raw);
        else if (f.type === 'number') data[f.name] = raw === '' ? null : Number(raw);
        else data[f.name] = raw.trim() === '' ? null : raw.trim();
        if (f.required && (data[f.name] === null || data[f.name] === 0)) return err(`${f.label} wajib diisi.`);
      }
      const save = $('#gen-save', root);
      save.disabled = true;
      try {
        await onSubmit(data);
        gen.close();
        onDone?.();
      } catch (ex) {
        err(ex.message);
        save.disabled = false;
      }
    });

    $('#gen-del', root)?.addEventListener('click', async () => {
      if (!confirm('Yakin ingin menghapus? Tindakan ini tidak bisa dibatalkan.')) return;
      try {
        await onDelete();
        gen.close();
        onDone?.();
      } catch (ex) { err(ex.message); }
    });
  });
}

// =====================================================================
// Pengaturan
// =====================================================================
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
      await refresh('wallets');
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
      await refresh('wallets');
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
      await refresh('wallets');
      if (!state.extrasError) await refresh('bills', 'debts', 'payments');
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
      await refresh('categories');
      toast('Kategori ditambahkan');
      renderSettings(v);
    } catch (err) { toast(err.message); }
  });

  $$('[data-del-cat]', v).forEach((b) => b.addEventListener('click', async () => {
    const c = catById(b.dataset.delCat);
    if (!confirm(`Hapus kategori "${c.name}"?\nTransaksi lama tetap ada, tetapi menjadi "Tanpa kategori".`)) return;
    try {
      await q(sb.from('categories').delete().eq('id', c.id));
      await refresh('categories', 'budgets');
      if (!state.extrasError) await refresh('bills');
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
let pendingBillId = null;
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

// t = transaksi yang diedit; preset = isian awal (mis. dari tagihan rutin)
function openTx(t = null, preset = null) {
  editing = t;
  pendingBillId = t ? null : (preset?.bill_id ?? null);
  const p = t ?? preset ?? {};
  const opts = state.wallets.map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join('');
  $('#wallet').innerHTML = opts;
  $('#to-wallet').innerHTML = opts;

  setKind(p.kind ?? 'expense');
  $('#tx-title').textContent = t ? 'Ubah transaksi' : pendingBillId ? 'Bayar tagihan' : 'Tambah transaksi';
  $('#quick-wrap').classList.toggle('hidden', !!(t || preset));
  $('#quick').value = '';
  $('#amount').value = p.amount ? fmtNum(p.amount) : '';
  if (p.category_id && catById(p.category_id)) $('#category').value = p.category_id;

  const wid = state.wallets.some((w) => w.id === p.wallet_id) ? p.wallet_id : lastWallet();
  $('#wallet').value = wid;
  $('#to-wallet').value = p.to_wallet_id ?? (state.wallets.find((w) => w.id !== wid)?.id ?? '');
  $('#date').value = p.tx_date ?? today();
  $('#note').value = p.note ?? '';
  $('#tx-delete').classList.toggle('hidden', !t);
  $('#tx-msg').textContent = '';
  $('#tx-save').disabled = false;

  dlg.showModal();
  if (!t && !preset) $('#quick').focus();
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
  if (!editing && pendingBillId && kind === 'expense') row.bill_id = pendingBillId;
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
    await refresh('wallets');
    await render();
    toast(editing ? 'Transaksi diperbarui' : row.bill_id ? 'Tagihan dibayar ✓' : 'Transaksi disimpan');
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
    await refresh('wallets');
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
export { parseQuick, monthRange, shiftMonth, monthsLeft, billDueDate, waPhone, daysBetween };

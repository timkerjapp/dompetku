-- =====================================================================
-- Dompetku — skema database Supabase (versi 2)
-- Jalankan di Supabase: SQL Editor → New query → tempel seluruh isi → Run
--
-- Aman dijalankan ulang. Jika sebelumnya sudah menjalankan versi 1,
-- cukup jalankan file ini lagi: data lama tidak hilang, tabel baru
-- (tagihan, target tabungan, utang piutang) akan ditambahkan.
-- =====================================================================

-- ---------- Dompet / akun (tunai, rekening, e-wallet) ----------
create table if not exists public.wallets (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 40),
  initial_balance numeric(14,2) not null default 0,
  created_at      timestamptz not null default now()
);

-- ---------- Kategori ----------
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 40),
  kind       text not null check (kind in ('income','expense')),
  icon       text not null default '•',
  created_at timestamptz not null default now()
);

-- ---------- Transaksi ----------
create table if not exists public.transactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind         text not null check (kind in ('income','expense','transfer')),
  amount       numeric(14,2) not null check (amount > 0),
  wallet_id    uuid not null references public.wallets(id) on delete cascade,
  to_wallet_id uuid references public.wallets(id) on delete cascade,
  category_id  uuid references public.categories(id) on delete set null,
  tx_date      date not null default current_date,
  note         text check (note is null or char_length(note) <= 200),
  created_at   timestamptz not null default now(),
  constraint transfer_target check ((kind = 'transfer') = (to_wallet_id is not null)),
  constraint transfer_diff   check (to_wallet_id is null or to_wallet_id <> wallet_id)
);
create index if not exists transactions_user_date_idx on public.transactions (user_id, tx_date desc);
create index if not exists transactions_wallet_idx    on public.transactions (wallet_id);
create index if not exists transactions_to_wallet_idx on public.transactions (to_wallet_id);

-- ---------- Anggaran bulanan per kategori ----------
create table if not exists public.budgets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  amount      numeric(14,2) not null check (amount > 0),
  created_at  timestamptz not null default now(),
  unique (user_id, category_id)
);

-- =====================================================================
-- BARU (v2): Perencanaan keuangan
-- =====================================================================

-- ---------- Tagihan rutin bulanan ----------
create table if not exists public.bills (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  amount      numeric(14,2) not null check (amount > 0),
  due_day     int  not null check (due_day between 1 and 31),
  category_id uuid references public.categories(id) on delete set null,
  wallet_id   uuid references public.wallets(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Transaksi pembayaran tagihan ditandai dengan bill_id
alter table public.transactions add column if not exists bill_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_bill_id_fkey') then
    alter table public.transactions
      add constraint transactions_bill_id_fkey
      foreign key (bill_id) references public.bills(id) on delete set null;
  end if;
end $$;
create index if not exists transactions_bill_idx on public.transactions (bill_id);

-- ---------- Target tabungan ----------
create table if not exists public.goals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 60),
  icon          text not null default '🎯',
  target_amount numeric(14,2) not null check (target_amount > 0),
  target_date   date,
  created_at    timestamptz not null default now()
);

-- Setoran (positif) / penarikan (negatif) ke target tabungan
create table if not exists public.goal_deposits (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id    uuid not null references public.goals(id) on delete cascade,
  amount     numeric(14,2) not null check (amount <> 0),
  dep_date   date not null default current_date,
  note       text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists goal_deposits_goal_idx on public.goal_deposits (goal_id);

-- =====================================================================
-- BARU (v2): Utang piutang
-- =====================================================================
-- kind = 'payable'    → utang saya (saya meminjam dari orang lain)
-- kind = 'receivable' → piutang (orang lain meminjam dari saya)
create table if not exists public.debts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('payable','receivable')),
  person     text not null check (char_length(person) between 1 and 60),
  phone      text check (phone is null or char_length(phone) <= 20),
  amount     numeric(14,2) not null check (amount > 0),
  start_date date not null default current_date,
  due_date   date,
  wallet_id  uuid references public.wallets(id) on delete set null,
  note       text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now()
);

create table if not exists public.debt_payments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  debt_id    uuid not null references public.debts(id) on delete cascade,
  amount     numeric(14,2) not null check (amount > 0),
  pay_date   date not null default current_date,
  wallet_id  uuid references public.wallets(id) on delete set null,
  note       text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists debt_payments_debt_idx on public.debt_payments (debt_id);

-- =====================================================================
-- Row Level Security: setiap pengguna hanya bisa melihat datanya sendiri
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['wallets','categories','transactions','budgets',
                           'bills','goals','goal_deposits','debts','debt_payments']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated
                    using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- Hapus policy lama dari versi 1 (sudah digantikan "own rows")
drop policy if exists "own wallets"      on public.wallets;
drop policy if exists "own categories"   on public.categories;
drop policy if exists "own transactions" on public.transactions;
drop policy if exists "own budgets"      on public.budgets;

-- =====================================================================
-- View saldo per dompet
-- saldo = saldo awal + transaksi + transfer masuk
--       + uang pinjaman yang diterima/diberikan + cicilan yang dibayar/diterima
-- =====================================================================
create or replace view public.wallet_balances
with (security_invoker = true) as
select
  w.id,
  w.name,
  w.initial_balance,
  w.created_at,
  w.initial_balance
    + coalesce((select sum(case when t.kind = 'income' then t.amount else -t.amount end)
                from public.transactions t where t.wallet_id = w.id), 0)
    + coalesce((select sum(t.amount)
                from public.transactions t
                where t.to_wallet_id = w.id and t.kind = 'transfer'), 0)
    + coalesce((select sum(case when d.kind = 'payable' then d.amount else -d.amount end)
                from public.debts d where d.wallet_id = w.id), 0)
    + coalesce((select sum(case when d.kind = 'payable' then -p.amount else p.amount end)
                from public.debt_payments p
                join public.debts d on d.id = p.debt_id
                where p.wallet_id = w.id), 0)
    as balance
from public.wallets w;

grant select on public.wallet_balances to authenticated;

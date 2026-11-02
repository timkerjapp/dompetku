-- =====================================================================
-- Dompetku — skema database Supabase
-- Jalankan sekali di Supabase: SQL Editor → New query → tempel → Run
-- =====================================================================

-- ---------- Tabel dompet / akun (tunai, rekening, e-wallet) ----------
create table if not exists public.wallets (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 40),
  initial_balance numeric(14,2) not null default 0,
  created_at      timestamptz not null default now()
);

-- ---------- Tabel kategori ----------
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 40),
  kind       text not null check (kind in ('income','expense')),
  icon       text not null default '•',
  created_at timestamptz not null default now()
);

-- ---------- Tabel transaksi ----------
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
  -- transfer wajib punya dompet tujuan; selain transfer tidak boleh
  constraint transfer_target check ((kind = 'transfer') = (to_wallet_id is not null)),
  constraint transfer_diff   check (to_wallet_id is null or to_wallet_id <> wallet_id)
);

create index if not exists transactions_user_date_idx on public.transactions (user_id, tx_date desc);
create index if not exists transactions_wallet_idx    on public.transactions (wallet_id);
create index if not exists transactions_to_wallet_idx on public.transactions (to_wallet_id);

-- ---------- Tabel anggaran bulanan per kategori ----------
create table if not exists public.budgets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  amount      numeric(14,2) not null check (amount > 0),
  created_at  timestamptz not null default now(),
  unique (user_id, category_id)
);

-- ---------- Row Level Security: tiap pengguna hanya melihat datanya sendiri ----------
alter table public.wallets      enable row level security;
alter table public.categories   enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets      enable row level security;

drop policy if exists "own wallets" on public.wallets;
create policy "own wallets" on public.wallets
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own categories" on public.categories;
create policy "own categories" on public.categories
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own transactions" on public.transactions;
create policy "own transactions" on public.transactions
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own budgets" on public.budgets;
create policy "own budgets" on public.budgets
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- View saldo per dompet (ikut aturan RLS pengguna) ----------
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
    as balance
from public.wallets w;

grant select on public.wallet_balances to authenticated;

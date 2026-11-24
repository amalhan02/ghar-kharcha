-- Household expense tracker: run this once in Supabase > SQL Editor.
-- Two logins, one shared budget. Every signed-in user can see and edit everything,
-- so turn OFF new sign-ups in Supabase (Authentication > Sign In / Providers) once you have both registered.

-- ---------- tables ----------
create table public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  display_name text not null,
  created_at   timestamptz not null default now()
);

create table public.settings (
  id             int primary key default 1 check (id = 1),   -- single row
  monthly_income numeric not null check (monthly_income >= 0),
  spend_cap_pct  numeric not null default 30 check (spend_cap_pct between 0 and 100),
  start_month    date not null                                -- funds start building from this month
);

create table public.categories (
  id             bigint generated always as identity primary key,
  name           text not null unique,
  grp            text not null check (grp in ('needs', 'wants')),
  -- monthly = budget resets every month; fund = unspent money carries over (trip, luxury, guilt-free, insurance)
  kind           text not null default 'monthly' check (kind in ('monthly', 'fund')),
  monthly_budget numeric not null default 0 check (monthly_budget >= 0),
  is_fixed       boolean not null default false,              -- same amount every month (rent, internet...)
  sort           int not null default 0,
  active         boolean not null default true
);

create table public.expenses (
  id          bigint generated always as identity primary key,
  spent_on    date not null default current_date,
  amount      numeric not null check (amount > 0),
  category_id bigint not null references public.categories,
  paid_by     uuid not null default auth.uid() references public.profiles,
  account     text not null default 'household' check (account in ('household', 'set_aside', 'own')),
  note        text,
  created_at  timestamptz not null default now()
);
create index expenses_spent_on_idx on public.expenses (spent_on);
create index expenses_category_idx on public.expenses (category_id);

-- ---------- profile is created automatically when someone signs up ----------
create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- row level security: signed-in household members only ----------
alter table public.profiles   enable row level security;
alter table public.settings   enable row level security;
alter table public.categories enable row level security;
alter table public.expenses   enable row level security;

create policy "members read profiles"  on public.profiles for select to authenticated using (true);
create policy "update own profile"     on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "members read settings"   on public.settings for select to authenticated using (true);
create policy "members update settings" on public.settings for update to authenticated using (true) with check (true);

create policy "members read categories"   on public.categories for select to authenticated using (true);
create policy "members insert categories" on public.categories for insert to authenticated with check (true);
create policy "members update categories" on public.categories for update to authenticated using (true) with check (true);

create policy "members read expenses"   on public.expenses for select to authenticated using (true);
create policy "members insert expenses" on public.expenses for insert to authenticated with check (true);
create policy "members update expenses" on public.expenses for update to authenticated using (true) with check (true);
create policy "members delete expenses" on public.expenses for delete to authenticated using (true);

-- ---------- starting data ----------
-- Your own income, cap and category budgets are personal, so they are not kept in this repo.
-- Set them in the app's Settings screen, or insert rows into public.categories here.
insert into public.settings (id, monthly_income, spend_cap_pct, start_month)
values (1, 0, 30, date_trunc('month', current_date)::date);

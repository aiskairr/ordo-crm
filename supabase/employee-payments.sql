create extension if not exists pgcrypto;

create table if not exists public.crm_employee_payments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.crm_users(id) on delete restrict,
  employee_name text not null,
  payment_type text not null default 'advance' check (payment_type in ('advance', 'salary')),
  amount numeric(14, 2) not null check (amount > 0),
  payment_date date not null default current_date,
  payment_method text not null default 'Наличные',
  comment text not null default '',
  status text not null default 'paid' check (status in ('paid', 'cancelled')),
  created_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists crm_employee_payments_employee_date_idx
  on public.crm_employee_payments (employee_id, payment_date desc);

create index if not exists crm_employee_payments_date_idx
  on public.crm_employee_payments (payment_date desc);

alter table public.crm_employee_payments enable row level security;

revoke all on table public.crm_employee_payments from anon, authenticated;
grant select, insert, update, delete on table public.crm_employee_payments to service_role;

comment on table public.crm_employee_payments is
  'Confirmed employee advance and salary payments recorded by ORDO CRM managers.';

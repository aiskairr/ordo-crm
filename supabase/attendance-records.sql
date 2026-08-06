create extension if not exists pgcrypto;

create table if not exists public.crm_attendance_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.crm_users(id) on delete restrict,
  user_name text not null,
  store_id text not null,
  store_name text not null,
  check_in_time timestamptz not null default now(),
  check_out_time timestamptz,
  total_work_minutes integer not null default 0 check (total_work_minutes >= 0),
  late_minutes integer not null default 0 check (late_minutes >= 0),
  status text not null default 'open' check (status in ('open', 'closed')),
  source text not null default 'wifi' check (source in ('wifi', 'geo', 'admin')),
  check_in_ip text,
  check_out_ip text,
  telegram_open_message_id bigint,
  telegram_close_message_id bigint,
  telegram_open_error text,
  telegram_close_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists crm_attendance_records_one_open_shift_idx
  on public.crm_attendance_records (user_id)
  where status = 'open';

create index if not exists crm_attendance_records_user_check_in_idx
  on public.crm_attendance_records (user_id, check_in_time desc);

create index if not exists crm_attendance_records_store_check_in_idx
  on public.crm_attendance_records (store_id, check_in_time desc);

create index if not exists crm_attendance_records_status_idx
  on public.crm_attendance_records (status, check_in_time desc);

create or replace function public.crm_attendance_records_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists crm_attendance_records_updated_at on public.crm_attendance_records;
create trigger crm_attendance_records_updated_at
before update on public.crm_attendance_records
for each row execute function public.crm_attendance_records_set_updated_at();

alter table public.crm_attendance_records enable row level security;

revoke all on table public.crm_attendance_records from anon, authenticated;
grant select, insert, update, delete on table public.crm_attendance_records to service_role;

comment on table public.crm_attendance_records is
  'Persistent ORDO CRM attendance shifts. Accessed only by the CRM backend with the Supabase service role.';

create extension if not exists pgcrypto;

create table if not exists public.crm_attendance_calendar (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('present', 'late', 'absent', 'holiday', 'day_off', 'leave', 'short_day', 'delivery')),
  date_from date not null,
  date_to date not null,
  user_id uuid references public.crm_users(id) on delete cascade,
  store_id text,
  title text not null default '',
  work_ends_at text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  constraint crm_attendance_calendar_date_range_check check (date_to >= date_from),
  constraint crm_attendance_calendar_work_ends_at_check check (
    work_ends_at = '' or work_ends_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  )
);

create index if not exists crm_attendance_calendar_dates_idx
  on public.crm_attendance_calendar (date_from, date_to);

create index if not exists crm_attendance_calendar_user_dates_idx
  on public.crm_attendance_calendar (user_id, date_from, date_to);

create index if not exists crm_attendance_calendar_store_dates_idx
  on public.crm_attendance_calendar (store_id, date_from, date_to);

alter table public.crm_attendance_calendar enable row level security;

revoke all on table public.crm_attendance_calendar from anon, authenticated;
grant select, insert, update, delete on table public.crm_attendance_calendar to service_role;

comment on table public.crm_attendance_calendar is
  'ORDO CRM attendance day marks, including holidays, leave, absence, short days and delivery overtime.';

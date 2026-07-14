create extension if not exists pgcrypto;

create table if not exists public.customs_calculator_history (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customs_calculator_history_pkey primary key (id),
  constraint customs_calculator_history_user_id_fkey
    foreign key (user_id) references public.crm_users(id) on delete cascade
);

create index if not exists customs_calculator_history_user_updated_idx
  on public.customs_calculator_history using btree (user_id, updated_at desc);

create or replace function public.customs_calculator_history_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists customs_calculator_history_updated_at on public.customs_calculator_history;
create trigger customs_calculator_history_updated_at
before update on public.customs_calculator_history
for each row execute function public.customs_calculator_history_set_updated_at();

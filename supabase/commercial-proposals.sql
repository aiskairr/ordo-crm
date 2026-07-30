create table if not exists public.commercial_proposals (
  token text primary key,
  payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists commercial_proposals_expires_at_idx
  on public.commercial_proposals (expires_at);

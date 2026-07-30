create extension if not exists pgcrypto;

create table if not exists public.crm_modules (
  key text primary key,
  title text not null,
  route text not null,
  icon text,
  enabled boolean default true,
  show_in_sidebar boolean default true,
  sidebar_order integer default 100,
  permissions text[] default '{}'::text[],
  updated_at timestamptz default now()
);

create table if not exists public.crm_system_settings (
  key text primary key,
  value jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.crm_integrations (
  key text primary key,
  value jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.crm_branches (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  name text not null,
  organization_href text,
  store_href text,
  retail_store_href text,
  sales_channel_href text,
  work_start text default '09:00',
  work_end text default '19:00',
  active boolean default true,
  updated_at timestamptz default now()
);

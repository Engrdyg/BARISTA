-- Tiyaga schema. Every study table is owned by one user (user_id) and is
-- readable and writable only by that user, and only if their profile role is
-- 'reviewee'. baon_notes has its own policies (spec §5.12).
--
-- Sync: clients pull rows by synced_at (set here by the server on every write),
-- and conflicts resolve last-write-wins on the client's updated_at.

create extension if not exists pgcrypto;

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'reviewee' check (role in ('reviewee', 'supporter')),
  display_name text,
  partner_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  synced_at timestamptz not null default now()
);

create or replace function public.is_reviewee() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'reviewee' and deleted_at is null)
$$;

create or replace function public.partner_of_me() returns uuid
language sql stable security definer set search_path = public as $$
  select partner_id from profiles where id = auth.uid()
$$;

-- Shared columns for every owned table.
create or replace function public.tiyaga_owned_table(tname text, cols text) returns void
language plpgsql as $$
begin
  execute format(
    'create table if not exists %I (
       id uuid primary key,
       user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
       %s,
       created_at timestamptz not null default now(),
       updated_at timestamptz not null default now(),
       deleted_at timestamptz,
       synced_at timestamptz not null default now()
     )', tname, cols);
  execute format('create index if not exists %I on %I (user_id, updated_at)', tname || '_user_updated', tname);
  execute format('create index if not exists %I on %I (user_id, synced_at)', tname || '_user_synced', tname);
  execute format('alter table %I enable row level security', tname);
  execute format('drop policy if exists owner_all on %I', tname);
  execute format(
    'create policy owner_all on %I for all to authenticated
       using (user_id = auth.uid() and public.is_reviewee())
       with check (user_id = auth.uid() and public.is_reviewee())', tname);
end $$;

select tiyaga_owned_table('settings', $c$ data jsonb not null default '{}'::jsonb $c$);

select tiyaga_owned_table('exam_configs', $c$
  name text not null,
  day1 date not null, day2 date not null, day3 date not null,
  am_start text not null, am_end text not null, pm_start text not null, pm_end text not null,
  questions_per_subject int not null default 20,
  points_per_question numeric not null default 5,
  coverage_cutoff date not null,
  passing_gwa numeric not null default 75,
  is_active boolean not null default true
$c$);

select tiyaga_owned_table('subjects', $c$
  code text not null, name text not null, weight numeric not null,
  exam_day int not null, session text not null, color text not null,
  difficulty text not null default 'normal', sort int not null default 0
$c$);

select tiyaga_owned_table('syllabus_nodes', $c$
  subject_id uuid not null, parent_id uuid, marker text not null default '',
  title text not null, sort int not null default 0, depth int not null default 0,
  status text not null default 'not_started', needs_work boolean not null default false,
  notes text not null default '', starred boolean not null default false,
  last_studied_at timestamptz, times_studied int not null default 0,
  unmatched boolean not null default false
$c$);

select tiyaga_owned_table('laws', $c$
  title text not null, short_name text not null default '', citation text not null default '',
  primary_subject_id uuid, source_url text not null default '', split_patterns jsonb
$c$);

select tiyaga_owned_table('provisions', $c$
  law_id uuid not null, label text not null, heading text not null default '', text text not null,
  sort int not null default 0, read_count int not null default 0, last_read_at timestamptz,
  notes text not null default '', starred boolean not null default false
$c$);

select tiyaga_owned_table('highlights', $c$
  provision_id uuid not null, start int not null, "end" int not null,
  color_key text not null, needs_review boolean not null default false
$c$);

select tiyaga_owned_table('digests', $c$
  subject_id uuid, title text not null, gr_no text not null default '', promulgated_on date,
  ponente text not null default '', division text, doctrine text not null,
  facts text not null default '', issues text not null default '', ruling text not null default '',
  notes text not null default '', separate_opinions text not null default '',
  source_url text not null default '', starred boolean not null default false
$c$);

select tiyaga_owned_table('cards', $c$
  subject_id uuid, type text not null, front text not null default '', back text not null default '',
  cloze_text text not null default '', source_type text, source_id uuid,
  tags text[] not null default '{}', suspended boolean not null default false,
  starred boolean not null default false
$c$);

select tiyaga_owned_table('card_items', $c$
  card_id uuid not null, cloze_index int,
  due timestamptz not null, stability double precision not null default 0,
  difficulty double precision not null default 0, elapsed_days int not null default 0,
  scheduled_days int not null default 0, learning_steps int not null default 0,
  reps int not null default 0, lapses int not null default 0, state int not null default 0,
  last_review timestamptz
$c$);

select tiyaga_owned_table('review_logs', $c$
  card_item_id uuid not null, rating int not null, reviewed_at timestamptz not null,
  duration_ms int not null default 0, state int not null, due timestamptz not null,
  stability double precision not null, difficulty double precision not null,
  elapsed_days int not null default 0, last_elapsed_days int not null default 0,
  scheduled_days int not null default 0, learning_steps int not null default 0,
  review timestamptz not null
$c$);

select tiyaga_owned_table('questions', $c$
  subject_id uuid, type text not null default 'essay', source_label text not null default '',
  year int, number text not null default '', text text not null, points numeric not null default 5,
  reference_answer text not null default '', form_type text not null default '', notes text not null default ''
$c$);

select tiyaga_owned_table('attempts', $c$
  mode text not null, subject_id uuid, started_at timestamptz not null, time_limit_sec int not null,
  submitted_at timestamptz, status text not null default 'in_progress', device_id text not null,
  bar_day_group_id uuid
$c$);

select tiyaga_owned_table('attempt_items', $c$
  attempt_id uuid not null, question_id uuid not null, position int not null,
  answer text not null default '', time_spent_sec int not null default 0,
  flagged boolean not null default false, score numeric, structure jsonb,
  error_tags text[] not null default '{}', checklist jsonb, grader_notes text not null default '',
  ai_notes jsonb
$c$);

select tiyaga_owned_table('mistakes', $c$
  subject_id uuid, node_id uuid, source_type text not null default 'manual', source_id uuid,
  what_went_wrong text not null, correct_rule text not null default '', error_type text not null default '',
  status text not null default 'open', card_id uuid
$c$);

select tiyaga_owned_table('study_sessions', $c$
  subject_id uuid, node_id uuid, kind text not null, source text not null,
  started_at timestamptz not null, ended_at timestamptz, duration_sec int not null default 0,
  paused_sec int not null default 0, paused_at timestamptz, note text not null default ''
$c$);

select tiyaga_owned_table('plans', $c$
  start_date date not null, hours_by_weekday jsonb not null, rest_rules jsonb not null default '{}'::jsonb,
  max_subjects_per_day int not null default 2, phases jsonb not null, generated_at timestamptz not null
$c$);

select tiyaga_owned_table('plan_blocks', $c$
  plan_id uuid not null, date date not null, subject_id uuid not null, minutes int not null,
  kind text not null, status text not null default 'planned', continue_node_id uuid
$c$);

select tiyaga_owned_table('events', $c$
  title text not null, starts_at timestamptz not null, ends_at timestamptz not null,
  kind text not null, subject_id uuid
$c$);

select tiyaga_owned_table('node_links', $c$
  node_id uuid not null, target_type text not null, target_id uuid not null
$c$);

select tiyaga_owned_table('form_checklists', $c$
  form_type text not null, items jsonb not null default '[]'::jsonb
$c$);

-- Profiles: each user reads and edits only their own row; role and partner
-- are set by the admin in the SQL editor (see README).
alter table profiles enable row level security;
drop policy if exists own_profile_read on profiles;
create policy own_profile_read on profiles for select to authenticated using (id = auth.uid());
drop policy if exists own_profile_update on profiles;
create policy own_profile_update on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create or replace function public.profiles_guard() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null and (new.role is distinct from old.role or new.partner_id is distinct from old.partner_id) then
    raise exception 'role and partner can only be changed by the admin';
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard on profiles;
create trigger profiles_guard before update on profiles for each row execute function profiles_guard();

-- Baon notes: written by the supporter, read and archived by the reviewee.
create table if not exists baon_notes (
  id uuid primary key,
  author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) <= 500),
  show_on date,
  seen_at timestamptz,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  synced_at timestamptz not null default now()
);
create index if not exists baon_recipient_synced on baon_notes (recipient_id, synced_at);
create index if not exists baon_author_synced on baon_notes (author_id, synced_at);
alter table baon_notes enable row level security;

drop policy if exists baon_read on baon_notes;
create policy baon_read on baon_notes for select to authenticated
  using (author_id = auth.uid() or recipient_id = auth.uid());
drop policy if exists baon_insert on baon_notes;
create policy baon_insert on baon_notes for insert to authenticated
  with check (author_id = auth.uid() and recipient_id = public.partner_of_me());
drop policy if exists baon_update on baon_notes;
create policy baon_update on baon_notes for update to authenticated
  using (author_id = auth.uid() or recipient_id = auth.uid())
  with check (author_id = auth.uid() or recipient_id = auth.uid());
drop policy if exists baon_delete on baon_notes;
create policy baon_delete on baon_notes for delete to authenticated using (author_id = auth.uid());

-- The recipient may only mark notes seen or archived, never edit them.
create or replace function public.baon_guard() returns trigger
language plpgsql as $$
begin
  if auth.uid() = old.recipient_id and auth.uid() <> old.author_id then
    if new.body is distinct from old.body or new.show_on is distinct from old.show_on
       or new.author_id is distinct from old.author_id or new.recipient_id is distinct from old.recipient_id
       or new.deleted_at is distinct from old.deleted_at then
      raise exception 'the recipient can only mark a note seen or archived';
    end if;
  end if;
  if new.recipient_id is distinct from old.recipient_id or new.author_id is distinct from old.author_id then
    raise exception 'author and recipient cannot change';
  end if;
  return new;
end $$;
drop trigger if exists baon_guard on baon_notes;
create trigger baon_guard before update on baon_notes for each row execute function baon_guard();

-- Server-side sync bookkeeping: stamp synced_at, and keep the newer row on
-- conflicting writes (last write wins on the client's updated_at).
create or replace function public.tiyaga_sync_stamp() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return old;
  end if;
  new.synced_at := clock_timestamp();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','settings','exam_configs','subjects','syllabus_nodes','laws','provisions','highlights',
    'digests','cards','card_items','review_logs','questions','attempts','attempt_items','mistakes',
    'study_sessions','plans','plan_blocks','events','node_links','form_checklists','baon_notes'
  ] loop
    execute format('drop trigger if exists sync_stamp on %I', t);
    execute format('create trigger sync_stamp before insert or update on %I for each row execute function tiyaga_sync_stamp()', t);
  end loop;
end $$;

-- A profile row for every new auth user (role defaults to reviewee).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, user_id, role) values (new.id, new.id, 'reviewee') on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- Users created before this migration ran.
insert into profiles (id, user_id, role) select id, id, 'reviewee' from auth.users on conflict (id) do nothing;

drop function if exists public.tiyaga_owned_table(text, text);

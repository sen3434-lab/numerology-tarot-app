-- ============================================================
-- OZ 넘버타로 — numerology + tarot personality app
-- Assumes the shared multi-app schema already exists in this Supabase
-- project (public.members, public.apps, public.enrollments, public.tarot_cards),
-- created by color-tarot-app's schema_migration.sql / schema_migration_2_multi_app.sql.
-- Run this once in Supabase SQL Editor, AFTER those.
-- ============================================================

-- 1) Register this app.
insert into public.apps (key, name) values
  ('numerology-tarot', 'OZ 넘버타로')
on conflict (key) do nothing;

-- 2) Profiles — the person being analyzed. One member can hold several:
--    always exactly one '본인' (self), plus any number of family/friends.
--    Adding a non-본인 profile is a paid feature, enforced below by trigger.
create table if not exists public.profiles (
  id bigserial primary key,
  member_id uuid not null references public.members(id) on delete cascade,
  app_key text not null default 'numerology-tarot' references public.apps(key),
  relation text not null default '본인' check (relation in ('본인','가족','친구','연인','배우자','기타')),
  name text not null,
  birth_date date not null,
  -- Which calendar birth_date itself was entered in. The *other* calendar's
  -- date (and therefore number/card) is derived from this one via
  -- korean-lunar-calendar, not asked for separately.
  is_lunar boolean not null default false,
  is_intercalation boolean not null default false,
  gender text check (gender in ('남성','여성')),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

-- Safe to re-run on a profiles table created before this column existed.
alter table public.profiles
  add column if not exists is_lunar boolean not null default false,
  add column if not exists is_intercalation boolean not null default false;

-- Widen the relation check to include '연인' on a profiles table created
-- before this option existed (default constraint name).
alter table public.profiles drop constraint if exists profiles_relation_check;
alter table public.profiles add constraint profiles_relation_check
  check (relation in ('본인','가족','친구','연인','배우자','기타'));

-- Only one '본인' profile per member per app.
create unique index if not exists profiles_one_self_per_member
  on public.profiles (member_id, app_key)
  where (relation = '본인');

alter table public.profiles enable row level security;

drop policy if exists "members can view own profiles" on public.profiles;
create policy "members can view own profiles" on public.profiles
  for select using (auth.uid() = member_id);
drop policy if exists "members can insert own profiles" on public.profiles;
create policy "members can insert own profiles" on public.profiles
  for insert with check (auth.uid() = member_id);
drop policy if exists "members can update own profiles" on public.profiles;
create policy "members can update own profiles" on public.profiles
  for update using (auth.uid() = member_id);
drop policy if exists "members can delete own profiles" on public.profiles;
create policy "members can delete own profiles" on public.profiles
  for delete using (auth.uid() = member_id);

-- Free members may only ever hold the one '본인' profile. Adding anyone
-- else (가족/친구/기타) requires an active subscription or student role
-- on this app's enrollment row.
create or replace function public.enforce_profile_tier_limit()
returns trigger
language plpgsql
security definer
as $$
declare
  v_role text;
  v_sub text;
begin
  if new.relation = '본인' then
    return new;
  end if;

  select role, subscription_status into v_role, v_sub
  from public.enrollments
  where member_id = new.member_id and app_key = new.app_key;

  if v_role = 'student' or v_sub = 'active' then
    return new;
  end if;

  raise exception 'upgrade_required: adding family/friend profiles requires a paid subscription';
end;
$$;

drop trigger if exists trg_enforce_profile_tier_limit on public.profiles;
create trigger trg_enforce_profile_tier_limit
  before insert on public.profiles
  for each row execute function public.enforce_profile_tier_limit();

-- 3) Major Arcana cards live in the shared tarot_cards table, tagged by
--    card_type, same convention as color-tarot's '컬러타로' rows.
alter table public.tarot_cards
  add column if not exists arcana_number int;

-- 4) Interpretation copy, keyed by card number + which aspect it reads
--    (external = 양력/외적 성향, internal = 음력/내적 성향). Free members
--    are shown only rows where arcana_number <= 9; paid members see the
--    full 0-21 range. Gating happens in the app, not via RLS, matching
--    how tarot_cards is already public-readable in the sibling apps.
--    Read like a saju reading: one personality section plus three luck
--    categories (재물운/애정운/건강운), not just a single blurb.
create table if not exists public.numerology_interpretations (
  id bigserial primary key,
  arcana_number int not null check (arcana_number between 0 and 21),
  aspect text not null check (aspect in ('external','internal')),
  tarot_card_id bigint references public.tarot_cards(id),
  title text,
  personality_text text,
  wealth_text text,
  love_text text,
  health_text text,
  created_at timestamptz not null default now(),
  unique (arcana_number, aspect)
);

alter table public.numerology_interpretations enable row level security;
drop policy if exists "public can read numerology_interpretations" on public.numerology_interpretations;
create policy "public can read numerology_interpretations" on public.numerology_interpretations
  for select using (true);

-- 5) Compatibility copy between two external-number cards. Paid-only
--    feature — the compatibility.html page itself checks subscription
--    status before ever querying this table.
-- 'kind' separates the general (외적/양력 number pair) reading from the
-- '속궁합' intimacy reading (내적/음력 number pair) — same 0-21 card space,
-- but the two numbers being paired come from different calendars, so they
-- need independent rows, not just different text on one row.
create table if not exists public.compatibility_matrix (
  id bigserial primary key,
  card_a_number int not null check (card_a_number between 0 and 21),
  card_b_number int not null check (card_b_number between 0 and 21),
  kind text not null default 'general' check (kind in ('general','intimacy')),
  summary_text text,
  -- Always 70-100 on purpose — this is a fun/vibes score, never a "bad
  -- match" verdict. 70s = 별로, 80s = 보통, 90s = 좋음.
  score int check (score between 70 and 100),
  created_at timestamptz not null default now(),
  unique (card_a_number, card_b_number, kind),
  check (card_a_number <= card_b_number)
);

-- Safe to re-run on a compatibility_matrix table created before these
-- columns existed. The old unique(card_a_number, card_b_number) constraint
-- (from before 'kind' existed) is replaced with one that includes it.
alter table public.compatibility_matrix
  add column if not exists score int check (score between 70 and 100),
  add column if not exists kind text not null default 'general' check (kind in ('general','intimacy'));

alter table public.compatibility_matrix drop constraint if exists compatibility_matrix_card_a_number_card_b_number_key;
alter table public.compatibility_matrix add constraint compatibility_matrix_card_a_number_card_b_number_kind_key
  unique (card_a_number, card_b_number, kind);

alter table public.compatibility_matrix enable row level security;
drop policy if exists "public can read compatibility_matrix" on public.compatibility_matrix;
create policy "public can read compatibility_matrix" on public.compatibility_matrix
  for select using (true);

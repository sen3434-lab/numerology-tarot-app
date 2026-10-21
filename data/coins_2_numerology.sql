-- ============================================================
-- OZ 넘버스 타로 — 코인으로 해설 열기
--
-- 먼저 coins_1_wallet.sql (공용 코인 지갑)을 실행한 뒤 한 번 실행하세요.
-- (coins_1 파일은 color-tarot-app/data 에 있습니다. 같은 Supabase 프로젝트.)
--
-- 무엇이 코인으로 열리나
--   성향 해설  : 프로필 1명의 외적(양력)+내적(음력) 4가지 해설 = 1코인
--   궁합       : 프로필 2명의 궁합 점수+해설(연인/배우자면 속궁합 포함) = 1코인
--   한 번 연 것은 다시 볼 때 무료 (프로필·숫자 조합별로 기록됨)
--   소울넘버와 카드 이름/이미지는 코인 없이 보임
--   가격은 coin_prices 표에서 바꿈 (app_key='numerology-tarot')
--
-- 왜 함수로 내주나
--   해설 표가 "누구나 읽기"로 열려 있으면 화면만 가려도 요청 한 번으로
--   전체를 가져갈 수 있음. 그래서 표 직접 읽기를 막고, 코인을 차감한
--   함수만 해설을 돌려주게 함. (관리 스크립트는 service_role 이라 영향 없음)
--
-- 재실행해도 안전합니다.
-- ============================================================

-- 가족/친구 프로필도 이제 누구나 추가 가능 (옛 유료 제한 제거).
-- 대신 계정당 30개까지만.
drop trigger if exists trg_enforce_profile_tier_limit on public.profiles;
drop function if exists public.enforce_profile_tier_limit();

create or replace function public.enforce_profile_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.profiles
      where member_id = new.member_id and app_key = new.app_key) >= 30 then
    raise exception 'profile_limit: at most 30 profiles per member';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_enforce_profile_cap on public.profiles;
create trigger trg_enforce_profile_cap
  before insert on public.profiles
  for each row execute function public.enforce_profile_cap();

-- ------------------------------------------------------------
-- 내부: 카드 번호 하나의 해설 묶음 (해설이 아직 없으면 JSON null)
-- ------------------------------------------------------------
create or replace function public._numerology_interp(p_arcana int, p_aspect text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select jsonb_build_object(
      'arcana_number', i.arcana_number,
      'aspect', i.aspect,
      'title', i.title,
      'personality_text', i.personality_text,
      'wealth_text', i.wealth_text,
      'love_text', i.love_text,
      'health_text', i.health_text,
      'card_name', tc.name)
    from public.numerology_interpretations i
    left join public.tarot_cards tc on tc.id = i.tarot_card_id
    where i.arcana_number = p_arcana and i.aspect = p_aspect
  ), 'null'::jsonb);
$$;

-- 내부: 두 프로필의 궁합 내용 + 열기 기록용 ref
create or replace function public._numerology_compat(
  p_uid uuid, p_a bigint, p_b bigint,
  p_a_ext int, p_b_ext int, p_a_int int, p_b_int int)
returns jsonb   -- {ref, romantic, general, intimacy, card_a_name, card_b_name} 또는 {error}
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rel_a text;
  v_rel_b text;
  v_romantic boolean;
  v_general jsonb;
  v_intimacy jsonb := 'null'::jsonb;
begin
  if p_a is null or p_b is null or p_a = p_b then
    return jsonb_build_object('error', 'bad_profiles');
  end if;
  if coalesce(p_a_ext, -1) not between 0 and 21 or coalesce(p_b_ext, -1) not between 0 and 21
     or coalesce(p_a_int, -1) not between 0 and 21 or coalesce(p_b_int, -1) not between 0 and 21 then
    return jsonb_build_object('error', 'bad_numbers');
  end if;

  select relation into v_rel_a from public.profiles
    where id = p_a and member_id = p_uid and app_key = 'numerology-tarot';
  select relation into v_rel_b from public.profiles
    where id = p_b and member_id = p_uid and app_key = 'numerology-tarot';
  if v_rel_a is null or v_rel_b is null then
    return jsonb_build_object('error', 'no_profile');
  end if;

  -- 속궁합은 "본인 + 연인/배우자" 조합에서만 (클라이언트 말은 믿지 않음)
  v_romantic := (v_rel_a = '본인' and v_rel_b in ('연인', '배우자'))
             or (v_rel_b = '본인' and v_rel_a in ('연인', '배우자'));

  select jsonb_build_object('summary_text', summary_text, 'score', score) into v_general
    from public.compatibility_matrix
    where card_a_number = least(p_a_ext, p_b_ext) and card_b_number = greatest(p_a_ext, p_b_ext)
      and kind = 'general';

  if v_romantic then
    select jsonb_build_object('summary_text', summary_text, 'score', score) into v_intimacy
      from public.compatibility_matrix
      where card_a_number = least(p_a_int, p_b_int) and card_b_number = greatest(p_a_int, p_b_int)
        and kind = 'intimacy';
  end if;

  return jsonb_build_object(
    'ref', least(p_a, p_b) || '-' || greatest(p_a, p_b)
           || ':' || least(p_a_ext, p_b_ext) || '-' || greatest(p_a_ext, p_b_ext)
           || ':' || case when v_romantic then least(p_a_int, p_b_int) || '-' || greatest(p_a_int, p_b_int) else 'x' end,
    'romantic', v_romantic,
    'general', coalesce(v_general, 'null'::jsonb),
    'intimacy', coalesce(v_intimacy, 'null'::jsonb),
    'card_a_name', public._numerology_interp(p_a_ext, 'external')->>'card_name',
    'card_b_name', public._numerology_interp(p_b_ext, 'external')->>'card_name');
end;
$$;

-- ------------------------------------------------------------
-- 앱이 부르는 함수
-- ------------------------------------------------------------
-- 성향 해설 열기 (코인 1개, 이미 열었으면 무료)
create or replace function public.numerology_unlock_result(p_profile_id bigint, p_ext int, p_int int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_res jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_logged_in');
  end if;
  if coalesce(p_ext, -1) not between 0 and 21 or coalesce(p_int, -1) not between 0 and 21 then
    return jsonb_build_object('ok', false, 'reason', 'bad_numbers');
  end if;
  if not exists (select 1 from public.profiles
                 where id = p_profile_id and member_id = v_uid and app_key = 'numerology-tarot') then
    return jsonb_build_object('ok', false, 'reason', 'no_profile');
  end if;

  v_res := public._unlock(v_uid, 'numerology-tarot', 'result',
                          p_profile_id || ':' || p_ext || '-' || p_int,
                          jsonb_build_object('ext', p_ext, 'int', p_int));
  if not coalesce((v_res->>'ok')::boolean, false) then
    return v_res;
  end if;
  return v_res || jsonb_build_object(
    'external', public._numerology_interp(p_ext, 'external'),
    'internal', public._numerology_interp(p_int, 'internal'));
end;
$$;

-- 이미 연 해설 다시 보기 (코인 차감 없음, 안 열었으면 locked)
create or replace function public.numerology_peek_result(p_profile_id bigint, p_ext int, p_int int)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_logged_in');
  end if;
  if coalesce(p_ext, -1) not between 0 and 21 or coalesce(p_int, -1) not between 0 and 21 then
    return jsonb_build_object('ok', false, 'reason', 'bad_numbers');
  end if;
  if not exists (select 1 from public.unlocked_items
                 where member_id = v_uid and app_key = 'numerology-tarot' and item = 'result'
                   and ref = p_profile_id || ':' || p_ext || '-' || p_int) then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;
  return jsonb_build_object(
    'ok', true, 'already', true,
    'external', public._numerology_interp(p_ext, 'external'),
    'internal', public._numerology_interp(p_int, 'internal'));
end;
$$;

-- 궁합 열기 (코인 1개, 이미 열었으면 무료)
create or replace function public.numerology_unlock_compat(
  p_a bigint, p_b bigint, p_a_ext int, p_b_ext int, p_a_int int, p_b_int int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_c jsonb;
  v_res jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_logged_in');
  end if;
  v_c := public._numerology_compat(v_uid, p_a, p_b, p_a_ext, p_b_ext, p_a_int, p_b_int);
  if v_c ? 'error' then
    return jsonb_build_object('ok', false, 'reason', v_c->>'error');
  end if;

  v_res := public._unlock(v_uid, 'numerology-tarot', 'compatibility', v_c->>'ref', null);
  if not coalesce((v_res->>'ok')::boolean, false) then
    return v_res;
  end if;
  return v_res || (v_c - 'ref');
end;
$$;

create or replace function public.numerology_peek_compat(
  p_a bigint, p_b bigint, p_a_ext int, p_b_ext int, p_a_int int, p_b_int int)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_c jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_logged_in');
  end if;
  v_c := public._numerology_compat(v_uid, p_a, p_b, p_a_ext, p_b_ext, p_a_int, p_b_int);
  if v_c ? 'error' then
    return jsonb_build_object('ok', false, 'reason', v_c->>'error');
  end if;
  if not exists (select 1 from public.unlocked_items
                 where member_id = v_uid and app_key = 'numerology-tarot'
                   and item = 'compatibility' and ref = v_c->>'ref') then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;
  return jsonb_build_object('ok', true, 'already', true) || (v_c - 'ref');
end;
$$;

-- ------------------------------------------------------------
-- 권한: 해설/궁합 표 직접 읽기 차단, 함수만 허용
-- ------------------------------------------------------------
drop policy if exists "public can read numerology_interpretations" on public.numerology_interpretations;
drop policy if exists "public can read compatibility_matrix" on public.compatibility_matrix;
revoke select on public.numerology_interpretations, public.compatibility_matrix from anon, authenticated;

revoke all on function public._numerology_interp(int,text)                          from public, anon, authenticated;
revoke all on function public._numerology_compat(uuid,bigint,bigint,int,int,int,int) from public, anon, authenticated;
revoke all on function public.numerology_unlock_result(bigint,int,int)              from public, anon;
revoke all on function public.numerology_peek_result(bigint,int,int)                from public, anon;
revoke all on function public.numerology_unlock_compat(bigint,bigint,int,int,int,int) from public, anon;
revoke all on function public.numerology_peek_compat(bigint,bigint,int,int,int,int)   from public, anon;

grant execute on function public.numerology_unlock_result(bigint,int,int)              to authenticated;
grant execute on function public.numerology_peek_result(bigint,int,int)                to authenticated;
grant execute on function public.numerology_unlock_compat(bigint,bigint,int,int,int,int) to authenticated;
grant execute on function public.numerology_peek_compat(bigint,bigint,int,int,int,int)   to authenticated;

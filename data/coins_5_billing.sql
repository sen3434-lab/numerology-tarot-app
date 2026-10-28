-- ============================================================
-- 구글 결제 연동용 DB 설정
--
-- coins_1_wallet.sql 을 먼저 실행한 뒤 한 번 실행하세요. 재실행 안전.
--
-- 왜 이 파일이 필요한가
--   결제가 끝나면 우리 서버가 "구글이 확인해 준 구매"에 코인을 지급해야 함.
--   코인 지급 함수(credit_purchase)는 service_role(전체 권한 키)만 쓸 수 있는데,
--   그 키를 인터넷에 열린 앱 서버에 두면 서버가 뚫릴 때 DB 전체가 위험해짐.
--   그래서 "결제 지급 전용 비밀번호"를 쓰는 얇은 함수를 따로 둠:
--     - 서버는 anon 키 + 이 비밀번호만 가짐 (전체 권한 키는 서버에 두지 않음)
--     - 비밀번호가 새도 할 수 있는 일은 "코인 지급/환불 회수"뿐
--     - DB에는 비밀번호의 해시(sha256)만 저장 (원문은 서버 .env 에만 있음)
--
-- 사용법은 맨 아래 "비밀번호 등록" 참고.
-- ============================================================

create table if not exists public.billing_secret (
  id int primary key check (id = 1),
  secret_hash text not null,
  updated_at timestamptz not null default now()
);
alter table public.billing_secret enable row level security;
revoke all on public.billing_secret from anon, authenticated;

create or replace function public._billing_secret_ok(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.billing_secret
    where id = 1
      and secret_hash = encode(sha256(convert_to(coalesce(p_secret, ''), 'utf8')), 'hex')
  );
$$;

-- 서버가 부르는 지급 함수: 비밀번호가 맞을 때만 credit_purchase 를 실행
create or replace function public.server_credit_purchase(
  p_secret text, p_member uuid, p_provider text, p_product_id text,
  p_order_id text, p_token text, p_raw jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public._billing_secret_ok(p_secret) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  return public.credit_purchase(p_member, p_provider, p_product_id, p_order_id, p_token, p_raw);
end;
$$;

-- 환불/취소된 구매의 코인 회수
create or replace function public.server_refund_purchase(p_secret text, p_provider text, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public._billing_secret_ok(p_secret) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  return public.refund_purchase(p_provider, p_token);
end;
$$;

revoke all on function public._billing_secret_ok(text) from public, anon, authenticated;
revoke all on function public.server_credit_purchase(text,uuid,text,text,text,text,jsonb) from public;
revoke all on function public.server_refund_purchase(text,text,text) from public;
grant execute on function public.server_credit_purchase(text,uuid,text,text,text,text,jsonb) to anon, authenticated, service_role;
grant execute on function public.server_refund_purchase(text,text,text) to anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 비밀번호 등록 (이 파일을 실행한 뒤)
--
-- 서버 .env 의 BILLING_SECRET 값을 sha256 으로 만든 "해시"만 아래에 넣습니다.
-- (Claude가 비밀번호를 만들어 서버 .env 에 넣고, 해시만 알려드립니다.
--  해시는 비밀이 아니라서 SQL 에 그대로 붙여도 안전합니다.)
--
--   insert into public.billing_secret (id, secret_hash)
--   values (1, '<알려드린 해시>')
--   on conflict (id) do update set secret_hash = excluded.secret_hash, updated_at = now();
--
-- 비밀번호 교체: 새 비밀번호를 서버 .env 에 넣고, 위 문장을 새 해시로 다시 실행.
-- ------------------------------------------------------------

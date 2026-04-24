-- ============================================
-- WCL 공유 캐시 테이블
-- ============================================
-- 모든 공개 WCL 쿼리 결과를 저장. 서버 (service_role)만 접근.
-- TTL 기반 만료는 application layer에서 체크 (expires_at 비교).

create table if not exists wcl_cache (
  key text primary key,
  value jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz default now(),
  hit_count integer default 0
);

-- 만료 엔트리 일괄 삭제용 인덱스
create index if not exists idx_wcl_cache_expires on wcl_cache(expires_at);

-- RLS 활성화 — 정책 없음 = service_role 외 전부 차단
alter table wcl_cache enable row level security;

-- 만료 cleanup 함수 (수동 호출 or cron)
create or replace function cleanup_wcl_cache() returns integer as $$
declare
  deleted_count integer;
begin
  delete from wcl_cache where expires_at < now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$ language plpgsql security definer;

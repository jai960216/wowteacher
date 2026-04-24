-- ============================================
-- 새 Supabase API key 포맷 대응 — service_role에 명시적 grant
-- ============================================
-- 새 format(sb_secret_*)은 기본 권한이 축소돼 있어 public schema 테이블
-- 접근 불가. service_role에 wcl_cache 테이블 읽기·쓰기 명시적 부여.

grant usage on schema public to service_role;
grant all privileges on table wcl_cache to service_role;
grant execute on function cleanup_wcl_cache() to service_role;

-- authenticator가 service_role로 switch role 할 수 있게
grant service_role to authenticator;

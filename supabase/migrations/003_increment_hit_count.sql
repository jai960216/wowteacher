-- ============================================
-- wcl_cache.hit_count atomic increment RPC
-- ============================================
-- cacheGet에서 update({ hit_count: undefined })는 무동작 → 항상 0 유지.
-- 진짜 증가하려면 SQL 측에서 hit_count = hit_count + 1을 돌려야 함.

create or replace function increment_wcl_cache_hit(cache_key text)
returns void as $$
begin
  update wcl_cache
  set hit_count = hit_count + 1
  where key = cache_key;
end;
$$ language plpgsql security definer;

grant execute on function increment_wcl_cache_hit(text) to service_role;

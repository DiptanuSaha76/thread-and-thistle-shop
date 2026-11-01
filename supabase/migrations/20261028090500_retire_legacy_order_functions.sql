-- =============================================================================
-- 7. Retire the legacy order functions (APPLY LAST, after the updated website is
--    deployed and a test order has succeeded).
--
-- public.place_order and public.cancel_my_order were created outside this
-- repository and their code could not be reviewed. The website now uses
-- public.create_order and public.cancel_order instead. This removes the ability
-- of browser sessions to call the old functions. Nothing is deleted: to undo,
-- grant EXECUTE back to the "authenticated" role.
-- =============================================================================
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('place_order', 'cancel_my_order', 'validate_promo')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.signature);
    raise notice 'Revoked browser access to %', r.signature;
  end loop;
end $$;

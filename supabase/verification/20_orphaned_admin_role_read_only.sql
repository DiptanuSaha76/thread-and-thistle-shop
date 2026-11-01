-- =============================================================================
-- ORPHANED ADMIN ROLE INVESTIGATION (READ-ONLY). Changes nothing.
-- Background: user_roles holds two 'admin' rows; one has no matching Auth user.
-- It grants nothing today (nobody can sign in as a user that does not exist),
-- but it should be understood before it is removed.
-- =============================================================================

-- 1. The orphaned row(s). Note the id and user_id privately.
select r.id as role_row_id, r.user_id, r.role
from public.user_roles r
left join auth.users u on u.id::text = r.user_id
where u.id is null;

-- 2. Does that user id appear anywhere else? (Evidence of past activity.)
with orphan as (
  select r.user_id from public.user_roles r left join auth.users u on u.id::text = r.user_id where u.id is null
)
select 'profiles' as found_in, count(*) from public.profiles where id in (select user_id from orphan)
union all select 'yearth_profiles', count(*) from public.yearth_profiles where user_id::text in (select user_id from orphan)
union all select 'yearth_addresses', count(*) from public.yearth_addresses where user_id::text in (select user_id from orphan)
union all select 'orders', count(*) from public.orders where user_id in (select user_id from orphan)
union all select 'support_messages', count(*) from public.support_messages where user_id in (select user_id from orphan)
union all select 'storage objects (owner)', count(*) from storage.objects where owner::text in (select user_id from orphan);

-- 3. Auth audit log entries mentioning that id (kept for a limited time; may be empty).
select created_at, payload ->> 'action' as action, payload ->> 'actor_username' as actor
from auth.audit_log_entries
where payload::text like any (
  select '%' || user_id::text || '%' from public.user_roles r
  where not exists (select 1 from auth.users u where u.id::text = r.user_id))
order by created_at desc
limit 50;

-- 4. Confirm the remaining admin is the intended owner (check the email yourself).
select u.email, u.email_confirmed_at, u.last_sign_in_at
from public.user_roles r join auth.users u on u.id::text = r.user_id
where r.role::text = 'admin';

-- WHEN YOU HAVE DECIDED (manual step, not part of the migrations):
--   1. Keep a copy of the row from query 1 (id, user_id, role).
--   2. To remove it:  delete from public.user_roles where id = '<role_row_id from query 1>';
--   3. To undo:       insert into public.user_roles (id, user_id, role) values ('<id>', '<user_id>', 'admin');

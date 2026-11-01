-- =============================================================================
-- 1. Customer profiles: public.profiles becomes the single source of truth.
--
-- * Adds two columns (phone_country, updated_at). Nothing is dropped.
-- * Creates each new user's profile inside the database at sign-up, from the
--   sign-up form (email/password) or the provider's data (Google/Apple), after
--   validating it. Invalid values are stored as empty so the customer is asked
--   to complete them; nothing is invented.
-- * Back-fills missing rows for existing users and fills ONLY EMPTY fields from
--   the legacy public.yearth_profiles table. yearth_profiles is left untouched.
-- * Customers can read their own row; administrators can read all rows.
--   All writes go through validated functions (no direct client UPDATE/INSERT).
--
-- Safe to run more than once. Apply after running
-- supabase/verification/00_preflight_read_only.sql.
-- =============================================================================

alter table public.profiles add column if not exists phone_country text not null default '';
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

-- The profile functions below use ON CONFLICT (id), which needs a unique key on profiles.id.
-- The live table has none (checked: no empty or repeated ids). Added only if no such key exists;
-- if a repeated id ever appeared, this statement fails and the whole migration is rolled back.
do $$
begin
  if not exists (
    select 1 from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
    where i.indrelid = 'public.profiles'::regclass and i.indisunique and i.indnatts = 1
      and i.indpred is null and a.attname = 'id'
  ) then
    alter table public.profiles add constraint profiles_id_key unique (id);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Validation helpers (pure functions, shared by triggers, functions and hooks).
-- Written without locale-dependent character classes so they behave the same on
-- every Postgres configuration. The browser applies a stricter Unicode check.
-- -----------------------------------------------------------------------------
create or replace function public.is_valid_person_name(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value is not null
     and char_length(btrim(p_value)) between 1 and 100
     -- no digits, no ASCII symbols other than space ' . - , no control characters
     and btrim(p_value) !~ '[0-9!"#$%&()*+,/:;<=>?@\[\\\]^_`{|}~[:cntrl:]]'
     -- at least one letter (ASCII) or any non-ASCII character (other scripts)
     and btrim(p_value) ~ '[A-Za-z]|[^\x01-\x7F]'
$$;

-- Mobile numbers in E.164 form for the countries offered on the sign-up form.
-- Keep in sync with callingCountries/mobilePatterns in src/lib/phone.ts.
create or replace function public.is_valid_mobile(p_phone text, p_country text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(case upper(coalesce(p_country, ''))
    when 'IN' then p_phone ~ '^\+91[6-9][0-9]{9}$'
    when 'US' then p_phone ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'
    when 'CA' then p_phone ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'
    when 'GB' then p_phone ~ '^\+447[0-9]{9}$'
    when 'AU' then p_phone ~ '^\+614[0-9]{8}$'
    when 'AE' then p_phone ~ '^\+9715[0-9]{8}$'
    when 'SG' then p_phone ~ '^\+65[89][0-9]{7}$'
    when 'DE' then p_phone ~ '^\+491[5-7][0-9]{8,9}$'
    when 'FR' then p_phone ~ '^\+33[67][0-9]{8}$'
    else false
  end, false)
$$;

-- Administrator check used by the new policies. Reads user_roles directly so it
-- does not depend on the exact signature of the existing has_role() function.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles
    -- user_roles.user_id is text on the live project; auth.uid() is uuid.
    where user_id = auth.uid()::text and role::text = 'admin'
  )
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- A profile is complete when the customer can place orders.
create or replace function public.profile_is_complete(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = p_user::text and first_name <> '' and last_name <> '' and phone <> ''
  )
$$;
revoke all on function public.profile_is_complete(uuid) from public, anon, authenticated;
grant execute on function public.profile_is_complete(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- Profile creation for new users (email/password and Google/Apple).
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  full_name text := btrim(coalesce(meta ->> 'full_name', meta ->> 'name', ''));
  v_first text;
  v_last text;
  v_phone text := btrim(coalesce(meta ->> 'phone', ''));
  v_country text := upper(btrim(coalesce(meta ->> 'phone_country', '')));
begin
  v_first := btrim(coalesce(nullif(meta ->> 'first_name', ''), nullif(meta ->> 'given_name', ''),
                            split_part(full_name, ' ', 1)));
  v_last := btrim(coalesce(nullif(meta ->> 'last_name', ''), nullif(meta ->> 'family_name', ''),
                           case when position(' ' in full_name) > 0
                                then substr(full_name, position(' ' in full_name) + 1) else '' end));
  if not public.is_valid_person_name(v_first) then v_first := ''; end if;
  if not public.is_valid_person_name(v_last) then v_last := ''; end if;
  if not public.is_valid_mobile(v_phone, v_country) then
    v_phone := '';
    v_country := '';
  end if;

  insert into public.profiles (id, email, first_name, last_name, name, phone, phone_country)
  values (
    new.id,
    coalesce(new.email, ''),
    v_first,
    v_last,
    left(coalesce(nullif(btrim(concat_ws(' ', nullif(v_first, ''), nullif(v_last, ''))), ''), full_name), 200),
    v_phone,
    v_country
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_user_profile() from public, anon, authenticated;

create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = coalesce(new.email, ''), updated_at = now() where id = new.id::text;
  return new;
end;
$$;
revoke all on function public.sync_profile_email() from public, anon, authenticated;

-- The repository's old drizzle migration declared an email-based admin trigger.
-- It does not exist live; make sure it can never be active.
drop trigger if exists on_auth_user_admin on auth.users;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.sync_profile_email();

-- -----------------------------------------------------------------------------
-- Back-fill (non-destructive: inserts missing rows, fills only empty fields).
-- -----------------------------------------------------------------------------
insert into public.profiles (id, email, name)
select u.id,
       coalesce(u.email, ''),
       left(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')), 200)
from auth.users u
on conflict (id) do nothing;

update public.profiles p
set email = u.email, updated_at = now()
from auth.users u
where u.id::text = p.id and p.email = '' and coalesce(u.email, '') <> '';

-- Legacy yearth_profiles: copy full_name and an Indian mobile number only where
-- the profile field is still empty. Other legacy phone formats are not guessed;
-- those customers are asked to confirm their number on their next visit.
with legacy as (
  select y.user_id,
         btrim(coalesce(y.full_name, '')) as full_name,
         regexp_replace(coalesce(y.phone, ''), '[^0-9+]', '', 'g') as digits
  from public.yearth_profiles y
), normalized as (
  select user_id, full_name,
         case
           when digits ~ '^\+91[6-9][0-9]{9}$' then digits
           when digits ~ '^(91|0)?[6-9][0-9]{9}$' then '+91' || right(digits, 10)
           else ''
         end as phone
  from legacy
)
update public.profiles p
set name = case when p.name = '' then left(n.full_name, 200) else p.name end,
    first_name = case when p.first_name = '' and public.is_valid_person_name(split_part(n.full_name, ' ', 1))
                      then split_part(n.full_name, ' ', 1) else p.first_name end,
    last_name = case when p.last_name = '' and position(' ' in n.full_name) > 0
                          and public.is_valid_person_name(substr(n.full_name, position(' ' in n.full_name) + 1))
                     then substr(n.full_name, position(' ' in n.full_name) + 1) else p.last_name end,
    phone = case when p.phone = '' and n.phone <> '' then n.phone else p.phone end,
    phone_country = case when p.phone = '' and n.phone <> '' then 'IN' else p.phone_country end,
    updated_at = now()
from normalized n
where n.user_id::text = p.id
  and (p.name = '' or p.first_name = '' or p.last_name = '' or p.phone = '');

-- New rows must hold an E.164 phone or nothing. NOT VALID: existing rows are not
-- re-checked, so this cannot fail on legacy data.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_phone_e164'
                   and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles
      add constraint profiles_phone_e164 check (phone = '' or phone ~ '^\+[1-9][0-9]{7,14}$') not valid;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Access rules.
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid()::text);

drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin on public.profiles
  for select to authenticated using (public.is_admin());

-- Writes only through the functions below (validated); existing policies that
-- allow writes become inert because the table privileges are removed.
revoke all on public.profiles from anon;
revoke insert, update, delete, truncate on public.profiles from authenticated;
grant select on public.profiles to authenticated;

-- -----------------------------------------------------------------------------
-- Customer-facing profile functions.
-- -----------------------------------------------------------------------------
create or replace function public.ensure_my_profile()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;
  insert into public.profiles (id, email, name)
  select u.id, coalesce(u.email, ''),
         left(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')), 200)
  from auth.users u
  where u.id = v_uid
  on conflict (id) do nothing;
end;
$$;
revoke all on function public.ensure_my_profile() from public, anon;
grant execute on function public.ensure_my_profile() to authenticated;

-- Updates only the arguments that are not null. Returns the saved row.
create or replace function public.save_my_profile(
  p_first_name text default null,
  p_last_name text default null,
  p_name text default null,
  p_phone text default null,
  p_phone_country text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_country text := upper(btrim(coalesce(p_phone_country, '')));
  v_row public.profiles;
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;
  if p_first_name is not null and not public.is_valid_person_name(p_first_name) then
    raise exception using errcode = '22023', message = 'INVALID_FIRST_NAME';
  end if;
  if p_last_name is not null and not public.is_valid_person_name(p_last_name) then
    raise exception using errcode = '22023', message = 'INVALID_LAST_NAME';
  end if;
  if p_name is not null and not public.is_valid_person_name(p_name) then
    raise exception using errcode = '22023', message = 'INVALID_NAME';
  end if;
  if p_phone is not null and not public.is_valid_mobile(btrim(p_phone), v_country) then
    raise exception using errcode = '22023', message = 'INVALID_PHONE';
  end if;

  perform public.ensure_my_profile();

  update public.profiles
  set first_name = coalesce(btrim(p_first_name), first_name),
      last_name = coalesce(btrim(p_last_name), last_name),
      name = coalesce(
        btrim(p_name),
        case when p_first_name is not null or p_last_name is not null
             then btrim(concat_ws(' ', coalesce(btrim(p_first_name), first_name), coalesce(btrim(p_last_name), last_name)))
        end,
        name),
      phone = coalesce(btrim(p_phone), phone),
      phone_country = case when p_phone is not null then v_country else phone_country end,
      updated_at = now()
  where id = v_uid::text
  returning * into v_row;

  return v_row;
end;
$$;
revoke all on function public.save_my_profile(text, text, text, text, text) from public, anon;
grant execute on function public.save_my_profile(text, text, text, text, text) to authenticated;

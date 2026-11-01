-- =============================================================================
-- 2. Sign-up protection.
--
-- * Disposable (temporary) email domains: an updatable blocklist plus an
--   allowlist that always wins. This cannot tell whether a mailbox exists or
--   receives mail; it only rejects clearly identified throw-away providers.
-- * public.check_signup_email(): lets the sign-up form warn early.
-- * public.hook_before_user_created(): Supabase "Before User Created" Auth Hook.
--   Enforces the same rules on the server, so calling the Auth API directly
--   cannot skip them. It must be ENABLED in the dashboard (see the checklist):
--   Authentication -> Hooks -> Before User Created -> Postgres -> this function.
--
-- The domain list is loaded by 20261028090150_disposable_email_domains_seed.sql.
-- =============================================================================

create table if not exists public.disposable_email_domains (
  domain text primary key check (domain = lower(domain) and domain ~ '^[a-z0-9.-]+\.[a-z0-9-]+$'),
  source text not null default 'manual',
  added_at timestamptz not null default now()
);

create table if not exists public.allowed_email_domains (
  domain text primary key check (domain = lower(domain) and domain ~ '^[a-z0-9.-]+\.[a-z0-9-]+$'),
  note text not null default '',
  added_at timestamptz not null default now()
);

-- Not readable or writable through the public API; only the functions below use them.
alter table public.disposable_email_domains enable row level security;
alter table public.allowed_email_domains enable row level security;
revoke all on public.disposable_email_domains, public.allowed_email_domains from anon, authenticated;

-- Legitimate providers and privacy relays that must never be blocked, even if a
-- future list update includes them by mistake.
insert into public.allowed_email_domains (domain, note) values
  ('gmail.com', 'Google'), ('googlemail.com', 'Google'),
  ('outlook.com', 'Microsoft'), ('hotmail.com', 'Microsoft'), ('live.com', 'Microsoft'), ('msn.com', 'Microsoft'),
  ('outlook.in', 'Microsoft'), ('hotmail.co.uk', 'Microsoft'),
  ('yahoo.com', 'Yahoo'), ('yahoo.co.in', 'Yahoo'), ('ymail.com', 'Yahoo'), ('rocketmail.com', 'Yahoo'),
  ('icloud.com', 'Apple'), ('me.com', 'Apple'), ('mac.com', 'Apple'),
  ('privaterelay.appleid.com', 'Apple "Hide My Email" (Sign in with Apple)'),
  ('proton.me', 'Proton'), ('protonmail.com', 'Proton'), ('pm.me', 'Proton'),
  ('rediffmail.com', 'Rediff'), ('zoho.com', 'Zoho'), ('zohomail.in', 'Zoho'),
  ('aol.com', 'AOL'), ('gmx.com', 'GMX'), ('gmx.de', 'GMX'), ('mail.com', 'mail.com'),
  ('yandex.com', 'Yandex'), ('fastmail.com', 'Fastmail'), ('tutanota.com', 'Tuta'), ('tuta.io', 'Tuta'),
  ('hey.com', 'HEY'), ('duck.com', 'DuckDuckGo Email Protection'),
  ('simplelogin.com', 'SimpleLogin'), ('mozmail.com', 'Firefox Relay')
on conflict (domain) do nothing;

-- True when the address's domain (or a parent domain) is on the blocklist and
-- neither it nor a parent is allowlisted.
create or replace function public.email_domain_is_disposable(p_email text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_domain text := rtrim(lower(btrim(regexp_replace(coalesce(p_email, ''), '^.*@', ''))), '.');
  v_labels text[];
  v_candidates text[] := '{}';
  i int;
begin
  if v_domain = '' or position('.' in v_domain) = 0 then
    return false;
  end if;
  v_labels := string_to_array(v_domain, '.');
  -- e.g. a.b.example.com -> {a.b.example.com, b.example.com, example.com}
  for i in 1 .. array_length(v_labels, 1) - 1 loop
    v_candidates := v_candidates || array_to_string(v_labels[i:array_length(v_labels, 1)], '.');
  end loop;
  if exists (select 1 from public.allowed_email_domains where domain = any (v_candidates)) then
    return false;
  end if;
  return exists (select 1 from public.disposable_email_domains where domain = any (v_candidates));
end;
$$;
revoke all on function public.email_domain_is_disposable(text) from public, anon, authenticated;
grant execute on function public.email_domain_is_disposable(text) to service_role, supabase_auth_admin;

-- For the sign-up form. Reveals nothing about existing accounts.
create or replace function public.check_signup_email(p_email text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_email is null or char_length(p_email) > 255 or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return 'invalid';
  end if;
  if public.email_domain_is_disposable(p_email) then
    return 'disposable';
  end if;
  return 'ok';
end;
$$;
revoke all on function public.check_signup_email(text) from public;
grant execute on function public.check_signup_email(text) to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Supabase Auth Hook: Before User Created.
-- Messages are shown to the person signing up, so they stay friendly and
-- identical to the constants in src/lib/auth.tsx (signupHookMessages).
-- -----------------------------------------------------------------------------
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_user jsonb := coalesce(event -> 'user', '{}'::jsonb);
  v_meta jsonb := coalesce(v_user -> 'user_metadata', '{}'::jsonb);
  v_provider text := coalesce(v_user -> 'app_metadata' ->> 'provider', 'email');
  v_email text := coalesce(v_user ->> 'email', '');
begin
  if v_email <> '' and public.email_domain_is_disposable(v_email) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 400,
      'message', 'Please use a permanent email address. Temporary or disposable email services aren''t accepted.'));
  end if;

  -- Email/password sign-ups must include the profile fields. Google/Apple users
  -- are asked for missing details after their first sign-in.
  if v_provider = 'email' then
    if not public.is_valid_person_name(v_meta ->> 'first_name')
       or not public.is_valid_person_name(v_meta ->> 'last_name') then
      return jsonb_build_object('error', jsonb_build_object(
        'http_code', 400,
        'message', 'Please enter your first and last name.'));
    end if;
    if not public.is_valid_mobile(v_meta ->> 'phone', v_meta ->> 'phone_country') then
      return jsonb_build_object('error', jsonb_build_object(
        'http_code', 400,
        'message', 'Please enter a valid mobile number for the selected country.'));
    end if;
  end if;

  return '{}'::jsonb;
end;
$$;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_before_user_created(jsonb) from authenticated, anon, public;
grant usage on schema public to supabase_auth_admin;

-- =============================================================================
-- 8. Mobile number verification by SMS code (provider: OneAPI).
--
-- * Adds profiles.phone_verified_at. Only the server-side verification function
--   below can set it; changing the phone number (or its country) clears it.
-- * Adds a private table of verification challenges. Codes are stored only as an
--   HMAC-SHA256 hash made by the website server with a secret the database never
--   sees (PHONE_OTP_SECRET); the plain code is never stored.
-- * Expiry, attempt limits, resend cooldown and per-user / per-number / per-IP
--   limits are enforced here, atomically, so they cannot be skipped by changing
--   browser requests.
-- * Browsers (anon/authenticated) have no access to the table or the functions;
--   only the website server (service role) calls them, after checking the
--   customer's session.
--
-- Additive and safe to re-run. Nothing existing is changed or removed. It does
-- not depend on 20261028090500_retire_legacy_order_functions.sql.
-- =============================================================================

alter table public.profiles add column if not exists phone_verified_at timestamptz;

-- A verified number stays verified only while it is unchanged.
create or replace function public.profiles_phone_verification_reset()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.phone_verified_at := null;
  elsif new.phone is distinct from old.phone
     or new.phone_country is distinct from old.phone_country then
    new.phone_verified_at := null;
  end if;
  return new;
end;
$$;
revoke all on function public.profiles_phone_verification_reset() from public, anon, authenticated;

drop trigger if exists profiles_phone_verification_reset on public.profiles;
create trigger profiles_phone_verification_reset
  before insert or update on public.profiles
  for each row execute function public.profiles_phone_verification_reset();

-- -----------------------------------------------------------------------------
-- Challenges (one row per code sent).
-- -----------------------------------------------------------------------------
create table if not exists public.phone_verification_challenges (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  phone_country text not null,
  otp_hash text not null check (otp_hash ~ '^[a-f0-9]{64}$'),
  ip_hash text check (ip_hash is null or ip_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'sending'
    check (status in ('sending', 'sent', 'send_failed', 'verified', 'expired', 'locked', 'superseded')),
  attempts integer not null default 0 check (attempts >= 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  sent_at timestamptz,
  verified_at timestamptz
);
create index if not exists phone_verification_challenges_user_idx
  on public.phone_verification_challenges (user_id, created_at desc);
create index if not exists phone_verification_challenges_phone_idx
  on public.phone_verification_challenges (phone, created_at desc);
create index if not exists phone_verification_challenges_ip_idx
  on public.phone_verification_challenges (ip_hash, created_at desc) where ip_hash is not null;
create index if not exists phone_verification_challenges_created_idx
  on public.phone_verification_challenges (created_at);

alter table public.phone_verification_challenges enable row level security;
revoke all on public.phone_verification_challenges from public, anon, authenticated;
grant select, insert, update, delete on public.phone_verification_challenges to service_role;

-- -----------------------------------------------------------------------------
-- Limits (keep in sync with src/lib/phone-verification/phone-verification.server.ts):
--   code valid 10 minutes; 5 wrong attempts per code; 60 s between codes;
--   per account 5/hour and 10/day; per number 5/hour and 10/day (across all
--   accounts); per IP address 15/hour and 40/day.
-- -----------------------------------------------------------------------------

-- Starts a new challenge for the account's CURRENT profile number. Returns
-- {"ok":true,...} or {"ok":false,"reason":...,"retry_after":seconds}.
create or replace function public.phone_otp_begin(
  p_user uuid,
  p_challenge uuid,
  p_phone text,
  p_otp_hash text,
  p_ip_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_retry integer;
begin
  if p_user is null or p_challenge is null or p_phone is null
     or coalesce(p_otp_hash, '') !~ '^[a-f0-9]{64}$'
     or (p_ip_hash is not null and p_ip_hash !~ '^[a-f0-9]{64}$') then
    raise exception using errcode = '22023', message = 'INVALID_ARGUMENT';
  end if;

  -- Serializes concurrent requests for the same account.
  select * into v_profile from public.profiles where id = p_user::text for update;
  if not found or v_profile.phone = '' then
    return jsonb_build_object('ok', false, 'reason', 'NO_PHONE');
  end if;
  if v_profile.phone <> p_phone then
    return jsonb_build_object('ok', false, 'reason', 'PHONE_CHANGED');
  end if;
  if not public.is_valid_mobile(v_profile.phone, v_profile.phone_country) then
    return jsonb_build_object('ok', false, 'reason', 'INVALID_PHONE');
  end if;
  if v_profile.phone_verified_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'ALREADY_VERIFIED');
  end if;

  -- Resend cooldown (60 seconds after the previous code for this account).
  select ceil(extract(epoch from (max(c.created_at) + interval '60 seconds' - now())))::integer
    into v_retry
    from public.phone_verification_challenges c
   where c.user_id = p_user and c.created_at > now() - interval '60 seconds';
  if coalesce(v_retry, 0) > 0 then
    return jsonb_build_object('ok', false, 'reason', 'COOLDOWN', 'retry_after', v_retry);
  end if;

  -- Hourly and daily limits per account, per number and per IP address.
  with windows(kind, win, lim) as (
    values ('user', interval '1 hour', 5), ('user', interval '24 hours', 10),
           ('phone', interval '1 hour', 5), ('phone', interval '24 hours', 10),
           ('ip', interval '1 hour', 15), ('ip', interval '24 hours', 40)
  ), recent as (
    select w.win, w.lim,
           (select array_agg(c.created_at order by c.created_at desc)
              from public.phone_verification_challenges c
             where c.created_at > now() - w.win
               and case w.kind
                     when 'user' then c.user_id = p_user
                     when 'phone' then c.phone = v_profile.phone
                     else p_ip_hash is not null and c.ip_hash = p_ip_hash
                   end) as times
      from windows w
  )
  select max(ceil(extract(epoch from (r.times[r.lim] + r.win - now()))))::integer
    into v_retry
    from recent r
   where coalesce(array_length(r.times, 1), 0) >= r.lim;
  if v_retry is not null then
    return jsonb_build_object('ok', false, 'reason', 'RATE_LIMITED', 'retry_after', greatest(v_retry, 1));
  end if;

  -- Only the newest code can be used.
  update public.phone_verification_challenges
     set status = 'superseded'
   where user_id = p_user and status in ('sending', 'sent');
  -- Housekeeping: the limits only look back 24 hours.
  delete from public.phone_verification_challenges where created_at < now() - interval '2 days';

  insert into public.phone_verification_challenges
    (id, user_id, phone, phone_country, otp_hash, ip_hash, status, expires_at)
  values
    (p_challenge, p_user, v_profile.phone, v_profile.phone_country, p_otp_hash, p_ip_hash,
     'sending', now() + interval '10 minutes');

  return jsonb_build_object('ok', true, 'expires_in', 600, 'resend_in', 60);
end;
$$;

-- Records whether the SMS provider accepted the message. Only a code that was
-- actually sent can be used.
create or replace function public.phone_otp_mark_sent(p_challenge uuid, p_sent boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.phone_verification_challenges
     set status = case when p_sent then 'sent' else 'send_failed' end,
         sent_at = case when p_sent then now() end
   where id = p_challenge and status = 'sending';
end;
$$;

-- Checks a code for the account's newest challenge. Every wrong guess is
-- counted (the function never raises for a wrong code, so the count is kept).
-- Returns {"ok":true,"reason":"VERIFIED"|"ALREADY_VERIFIED"} or
-- {"ok":false,"reason":"INCORRECT"|"LOCKED"|"EXPIRED"|"NO_ACTIVE_CODE",...}.
create or replace function public.phone_otp_verify(p_user uuid, p_otp_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_challenge public.phone_verification_challenges;
  v_max_attempts constant integer := 5;
begin
  if p_user is null or coalesce(p_otp_hash, '') !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'INVALID_ARGUMENT';
  end if;

  select * into v_profile from public.profiles where id = p_user::text for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'NO_ACTIVE_CODE');
  end if;
  if v_profile.phone_verified_at is not null then
    return jsonb_build_object('ok', true, 'reason', 'ALREADY_VERIFIED');
  end if;

  select * into v_challenge
    from public.phone_verification_challenges
   where user_id = p_user and status = 'sent'
   order by created_at desc
   limit 1
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'NO_ACTIVE_CODE');
  end if;

  if v_challenge.expires_at <= now() then
    update public.phone_verification_challenges set status = 'expired' where id = v_challenge.id;
    return jsonb_build_object('ok', false, 'reason', 'EXPIRED');
  end if;
  -- The number was changed after the code was sent.
  if v_challenge.phone <> v_profile.phone or v_challenge.phone_country <> v_profile.phone_country then
    update public.phone_verification_challenges set status = 'superseded' where id = v_challenge.id;
    return jsonb_build_object('ok', false, 'reason', 'NO_ACTIVE_CODE');
  end if;
  if v_challenge.attempts >= v_max_attempts then
    update public.phone_verification_challenges set status = 'locked' where id = v_challenge.id;
    return jsonb_build_object('ok', false, 'reason', 'LOCKED');
  end if;

  if v_challenge.otp_hash <> p_otp_hash then
    update public.phone_verification_challenges
       set attempts = attempts + 1,
           status = case when attempts + 1 >= v_max_attempts then 'locked' else status end
     where id = v_challenge.id;
    if v_challenge.attempts + 1 >= v_max_attempts then
      return jsonb_build_object('ok', false, 'reason', 'LOCKED');
    end if;
    return jsonb_build_object('ok', false, 'reason', 'INCORRECT',
                              'attempts_left', v_max_attempts - v_challenge.attempts - 1);
  end if;

  update public.phone_verification_challenges
     set attempts = attempts + 1, status = 'verified', verified_at = now()
   where id = v_challenge.id;
  update public.profiles set phone_verified_at = now(), updated_at = now() where id = p_user::text;
  return jsonb_build_object('ok', true, 'reason', 'VERIFIED');
end;
$$;

-- Resend countdown and whether a usable code is outstanding (for the page).
create or replace function public.phone_otp_status(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'resend_in', greatest(0, coalesce((
      select ceil(extract(epoch from (max(c.created_at) + interval '60 seconds' - now())))::integer
        from public.phone_verification_challenges c
       where c.user_id = p_user and c.created_at > now() - interval '60 seconds'), 0)),
    'code_active', exists (
      select 1 from public.phone_verification_challenges c
       where c.user_id = p_user and c.status = 'sent' and c.expires_at > now()))
$$;

revoke all on function public.phone_otp_begin(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.phone_otp_mark_sent(uuid, boolean) from public, anon, authenticated;
revoke all on function public.phone_otp_verify(uuid, text) from public, anon, authenticated;
revoke all on function public.phone_otp_status(uuid) from public, anon, authenticated;
grant execute on function public.phone_otp_begin(uuid, uuid, text, text, text) to service_role;
grant execute on function public.phone_otp_mark_sent(uuid, boolean) to service_role;
grant execute on function public.phone_otp_verify(uuid, text) to service_role;
grant execute on function public.phone_otp_status(uuid) to service_role;

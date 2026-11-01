# Backend setup and go-live checklist

This store uses Supabase (database + Auth) and optional Razorpay payments. The code
in this repository is ready, but several things live outside the code and must be
configured by the project owner. Nothing below should be skipped before taking real
orders.

> Never paste keys or passwords into chats, tickets or commits. Put them only in the
> Supabase dashboard, the Razorpay dashboard and your hosting provider's environment
> variables.

## 0. Before you start

1. Confirm you are in the right Supabase project: the dashboard URL
   (`/dashboard/project/<ref>`), **Project Settings → General → Reference ID** and the
   host in `VITE_SUPABASE_URL` must match. (`supabase/config.toml` still holds an older
   id; it is not used by the website. Do not rely on it.)
2. Take a backup (Database → Backups, or export the tables you care about).
3. Run `supabase/verification/00_preflight_read_only.sql` in the SQL editor. It only
   reads. Section 3 must return no rows; section 6 must show no trigger that
   `touches_stock` on `orders`.

## 1. Apply the database migrations (in order)

Apply **all** files in `supabase/migrations/` **once, in filename order** (oldest first),
with one method:

- **Supabase CLI (recommended):** `supabase link --project-ref <your-ref>`, then
  `supabase db push`. The CLI applies the pending files in filename order and records
  what it applied, so it never re-runs a single older file on its own.
- **SQL editor:** paste each file in the order of the table below, top to bottom, without
  skipping any.

All 14 files are applied in one sequence, including
`20261028090500_retire_legacy_order_functions.sql` in its normal place (see the note
below the table).

**15th file, later and separately:** `20261029090000_require_verified_mobile_for_orders.sql`
makes the database refuse orders from customers whose mobile number is not SMS-verified.
Apply it **only after** the website version with SMS sign-up is live and a test customer
has verified a number by SMS (section 6a). Note that `supabase db push` applies every
pending file, including this one, so do not run `db push` before that point.

| File | What it does |
| --- | --- |
| `20261028090000_customer_profiles.sql` | `profiles` becomes the source of truth; profile created at sign-up; validated profile functions |
| `20261028090100_signup_guard.sql` | Disposable-email blocklist/allowlist + the sign-up Auth Hook function |
| `20261028090150_disposable_email_domains_seed.sql` | The domain list (~10,000 rows; large file - if the editor refuses it, run it with the CLI or `psql`) |
| `20261028090200_customer_data.sql` | Owner-only rules for addresses/preferences; saved bag table |
| `20261028090300_orders_checkout_payments.sql` | Secure order creation, stock locking, order guard rails, payment records. **Do not re-run this file on its own** once later files are applied (see below) |
| `20261028090400_catalogue_admin_access.sql` | Admin policies; hides cost prices and promo codes from the public API |
| `20261028090500_retire_legacy_order_functions.sql` | Removes browser access to the old `place_order`, `cancel_my_order` and `validate_promo` functions (if they exist). Applied in its normal place in the sequence |
| `20261028090600_phone_verification.sql` | Mobile number verification by SMS code (section 6a) |
| `20261028090700_shipment_tracking.sql` | Private cache for Shiprocket tracking (section 6b) |
| `20261028090800_payment_refunds.sql` | Refund tracking for Razorpay payments (section 6, step 7). Replaces `mark_order_paid()` from `...090300` |
| `20261028090900_wishlist_reviews_support.sql` | Wishlist clean-up, product reviews, contact form storage and limits (section 8a) |
| `20261028091000_product_images_storage.sql` | Only admins can upload/replace/delete product images (section 8b) |
| `20261028091100_order_status_timestamps.sql` | Records the real time an order is marked Shipped / Delivered for the My Orders timeline (needs the matching website code). Gives customers read access to the two new columns. Older orders show "Date not recorded" |
| `20261028091200_catalogue_ids_and_size_key.sql` | New products and sizes get an id automatically (existing ids unchanged), and sizes get the unique key (product, colour, size) the admin panel's "save sizes" needs |
| `20261029090000_require_verified_mobile_for_orders.sql` | **Apply last, separately** (see above). Orders need an SMS-verified mobile number. Changes one function only; no tables or rows |

**Live database column types.** The live project stores all ids as text (lowercase UUID
strings), order amounts/quantities, order dates and contact-message dates as text,
catalogue prices/stock/settings as `bigint`, and promo-code `percent`/`active` as text. The
migrations are written for these types and do not change any existing column's type:

- ids are compared as text (`id = auth.uid()::text`); new order, order-item and
  contact-message ids are created as lowercase UUID text;
- dates written into text columns use one format, UTC ISO 8601 (`2026-10-28T18:03:38.175Z`,
  via `public.iso_utc_text()`), so they parse in browsers and sort correctly;
- order numbers are created by `create_order` as `YE` + a number from
  `public.order_number_seq`, starting at YE1001 (a new numbering chosen for this store);
- `profiles.id` gets a unique key (`profiles_id_key`, added only if missing) because the
  profile functions use `ON CONFLICT (id)`; it is not made a primary key;
- `product_reviews.product_id` has no foreign key, because `products.id` has no unique key.

The website converts text amounts to numbers when it reads orders (`amountFromDb` in
`src/lib/store/orders.ts`, also used by the admin data loader), and the payment code
converts `orders.total` before charging.

**About `20261028090500_retire_legacy_order_functions.sql`.** No other migration depends on
it, it depends on none of them, and the updated website does not use the three old
functions. Its only effect is on the *old* website, which already stops working correctly
once `...090300` and `...090400` hide columns it reads (cost prices and admin notes). So
there is nothing to gain by holding it back: apply it in its normal place with the others.
(The "APPLY LAST" note inside that file was written before the newer files existed; this
guide replaces it.) To undo it, grant EXECUTE on those functions back to `authenticated`.

**Re-running files.** Re-applying the **whole** sequence in filename order is safe and does
not delete data. Re-running a **single older file** on its own after newer files have been
applied is not:

- **`20261028090300_orders_checkout_payments.sql` must not be re-run on its own** after
  later files. It would put back its original `mark_order_paid()` (so late or duplicate
  Razorpay payments would no longer be recorded as refunds owed, see `...090800`) and
  reset what customers may read on orders (so My Orders, which reads `shipped_at` /
  `delivered_at` from `...091100`, would fail to load).
- If that happened by mistake, re-apply every file from `20261028090300_...` to the newest
  one, in filename order (or the whole sequence). That restores both.

**Deploy the updated website at the same time** as you apply the migrations: the old
website reads columns that `...090300` and `...090400` hide, and the new website needs the
functions and columns these migrations create.

Before applying, run `supabase/verification/00_preflight_read_only.sql`; sections 12 and 13
must return no rows, and section 14 must show `orders = 0`, `order_items = 0` and zero
duplicates.

Then run the read-only checks: `supabase/verification/10_post_migration_checks_read_only.sql`,
`30_phone_and_tracking_checks_read_only.sql` (for `...090600` and `...090700`) and
`40_product_images_storage_read_only.sql` (for `...091000`; see section 8b). Every `ok`
should be `true`.

Regenerate the TypeScript types (the repository's copy was updated by hand to match).
Regenerated types will show the live text/`bigint` columns (for example `orders.total` as
`string`); the website already converts order amounts with `amountFromDb`:

```sh
npx supabase gen types typescript --project-id <your-ref> > src/integrations/supabase/types.ts
```

## 2. Supabase Auth settings (Dashboard → Authentication)

- **Sign In / Providers → Email**: Email enabled; **Confirm email OFF** (see below);
  Secure email change ON; minimum password length **8**; password requirements
  **letters and digits**; Email OTP expiry e.g. 600-1800 seconds (used by password reset).
- **Why "Confirm email" is OFF.** New customers verify their **mobile number by SMS**
  (section 6a), not an email link. With "Confirm email" ON, Supabase emails a link and
  does not sign the customer in, so the SMS step cannot start; the website therefore
  refuses new sign-ups ("mobile verification isn't set up yet") until the setting is OFF,
  and never falls back to the email link. Consequences of switching it OFF:
  - Supabase no longer proves that the customer owns the email address. Someone could
    sign up with an address that is not theirs (they still need their own mobile number).
    Order emails would then go to that address, and the real owner can still take the
    account over with "Forgot password".
  - Accounts are created immediately, so the sign-up hook and the website's checks are
    the only gate. Existing accounts are not changed.
  - Password reset, email change (with "Secure email change" ON) and Google/Apple sign-in
    are unaffected.
  Switch it OFF only **after** section 6a is configured and tested.
- Leaked-password protection: turn on if your plan offers it.
- **Phone** sign-ups: off (phone numbers are stored on the profile, not used to log in).
- Anonymous sign-ins: off. MFA: not required for login.
- **URL Configuration**: Site URL = your live domain. Redirect URLs: your domain and
  `http://localhost:3000`, covering `/login`, `/verify` and `/reset-password`
  (e.g. `https://your-domain/**`).
- **Email Templates → Reset password** keeps its link. (The *Confirm signup* template is
  not sent while "Confirm email" is OFF; the website's `/verify` page still handles older
  confirmation links and codes.)
- **Auth Hooks → Before User Created**: enable, type *Postgres*, schema `public`,
  function `hook_before_user_created`. Test with a normal sign-up afterwards. If it ever
  blocks all sign-ups, disable it here first. Note: users you create by hand in the
  dashboard have no name/phone, so the hook will refuse them while it is on.
- **Rate limits**: after custom SMTP is set up, raise the email limit to your expected
  sign-up volume.

## 3. Email delivery (required for real customers)

Sign-up no longer sends email, but password-reset emails still do. Supabase's built-in
mailer only delivers to members of your Supabase team (about two emails per hour).
Customers will **not** receive reset emails until custom SMTP is set up:
**Authentication → SMTP Settings** with your provider's host, port, username,
password, sender address and sender name, plus the DNS records (SPF/DKIM) your provider
asks for. Then sign up with an outside Gmail/Outlook address and confirm the code
arrives (and not in spam).

## 4. Google sign-in

1. Google Cloud Console → OAuth consent screen (app name, support email, your domain).
2. Credentials → OAuth client ID → *Web application*. Authorized redirect URI:
   `https://<your-ref>.supabase.co/auth/v1/callback`.
3. Supabase → Authentication → Providers → Google: paste the Client ID and Client
   Secret, enable.
4. Test: sign in with Google → you are asked for your mobile number → you continue.

## 5. Sign in with Apple

Requires a paid Apple Developer Program membership.

1. Create an App ID with *Sign in with Apple*, a **Services ID** (this is the client id),
   and a *Sign in with Apple* key (Key ID + `.p8` file). Note your Team ID.
2. Return URL: `https://<your-ref>.supabase.co/auth/v1/callback`.
3. Supabase → Providers → Apple: enter the Services ID and the client secret generated
   from the key. **The secret expires after at most 6 months - set a calendar reminder.**
4. Apple may share a private relay email (`…@privaterelay.appleid.com`); this is
   allowed. Apple may not share the name; the customer is asked for it.

## 6. Online payments (Razorpay) - optional

Until configured, checkout offers Cash on Delivery only and online methods show
"Not available yet". No order is ever marked paid without server-side verification.

1. Razorpay Dashboard: create API keys (start with **Test mode**). Make sure payments
   are **captured automatically** (Payment capture settings); orders are marked paid
   only once a payment is *captured*.
2. Hosting environment variables (server only, never `VITE_`):
   `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
3. Razorpay → Webhooks → add `https://<your-domain>/api/razorpay/webhook` with a secret
   (the same value as `RAZORPAY_WEBHOOK_SECRET`) and the events `payment.captured`,
   `order.paid`, `payment.failed`.
4. Admin panel → Settings → enable **Online payments**.
5. Schedule the expiry job (releases stock from abandoned unpaid online orders) every
   15-30 minutes: `POST https://<your-domain>/api/cron/expire-orders` with header
   `Authorization: Bearer <CRON_SECRET>` (any scheduler: cron-job.org, GitHub Actions,
   or Supabase `pg_cron` + `pg_net`).
6. Test with Razorpay test cards/UPI, then switch to live keys.
7. Refunds. Customers cannot cancel orders that are already paid. When money has to go
   back - an admin cancels a paid order, a payment arrives after its order was cancelled
   or expired, or a second payment arrives for a paid order - it appears in
   **Admin -> Orders -> Refunds owed**. Nothing is refunded automatically. For each case:
   - **Refund via Razorpay** sends a full refund. It first checks Razorpay for an earlier
     refund and uses Razorpay's idempotency key, so pressing it again (e.g. after a
     timeout) cannot refund twice.
   - **Check status** refreshes a pending refund.
   - **Record refund ID** - if you refunded in the Razorpay dashboard, paste the
     `rfnd_...` ID; it is checked with Razorpay (same payment, full amount).
   - **Mark refunded outside Razorpay** closes a case with a note (e.g. bank transfer).
   Try a refund with **Test mode** keys first. Partial refunds are not tracked here.

## 6a. Mobile number verification by SMS (OneAPI) - required

**Required for sign-up.** Customers sign up with first name, last name, email, password
and an Indian (+91) mobile number, are signed in, and must enter the SMS code before they
can use their account or check out. Google/Apple customers and existing customers are
taken to the same step the next time they sign in. Until the three variables below are
set, new sign-ups are refused with "mobile verification isn't set up yet", and signed-in
customers see "Mobile verification isn't available right now" instead of their account.
**Set this up before deploying this version of the website.**

The website enforces this in the browser. To make the database refuse orders from
customers without a verified number as well, apply
`20261029090000_require_verified_mobile_for_orders.sql` - **only after** SMS works on the
live site (otherwise nobody can place an order). Do not apply it with the other
migrations automatically.

One verified account per mobile number: a number that another account has already
verified cannot be verified again (checked by the server when sending and when
checking a code).

How it works: OneAPI only *delivers* the code. The website server creates a random
6-digit code, stores only a keyed hash of it, sends it to the number saved on the
customer's profile, and checks it. Codes expire after 10 minutes; 5 wrong attempts
lock a code; 60 seconds between codes; at most 5 codes per hour / 10 per day per
account and per number, and 15 per hour / 40 per day per IP address. Changing the
number removes its verified status.

1. From the client / OneAPI: the API key, and the **brand name OneAPI has approved for
   this shop** (the documentation's `OnePayment` is only an example). Confirm the
   questions listed in the report (DLT template, number format, balance, limits).
2. Hosting environment variables (server only, never `VITE_`):
   `ONEAPI_SMS_API_KEY`, `ONEAPI_SMS_BRAND_NAME`, `PHONE_OTP_SECRET` (a random value of
   at least 32 characters, e.g. from `openssl rand -hex 32`; changing it invalidates
   codes already sent, nothing else). `ONEAPI_SMS_ENDPOINT` only if OneAPI gives you a
   different address.
3. Apply `20261028090600_phone_verification.sql` (part of the single migration sequence in section 1).
4. Switch "Confirm email" OFF (section 2).
5. Test with your own Indian mobile number: sign up, wait for the code, enter a wrong
   code once, then the right one; you should land on your account.
6. Only Indian (+91) numbers can receive codes for now, so sign-up accepts Indian numbers
   only, and existing customers with another country's number are asked to change it.

## 6b. Order tracking with Shiprocket - optional

Manual shipments only: create the shipment in the Shiprocket dashboard as usual, then
in Admin -> Orders set the status to **Shipped** and paste the **AWB number** into
"Tracking number". The customer's "Track Order" then shows the courier status and scan
history from Shiprocket. The website never creates shipments, assigns couriers, books
pickups or buys labels, and tracking never changes an order's status.

Until switched on, "Track Order" shows the tracking number the admin entered (no fake
number) and asks the customer to use the courier's website.

1. Confirm with Shiprocket that the client's plan allows API access (and any charges).
2. Shiprocket -> Settings -> API -> create an **API user** (an email different from
   the main login). Shiprocket emails its password.
3. Hosting environment variables (server only): `SHIPROCKET_API_EMAIL`,
   `SHIPROCKET_API_PASSWORD`, and `SHIPROCKET_TRACKING_ENABLED=true`.
4. Apply `20261028090700_shipment_tracking.sql` (part of the single migration sequence in section 1).
5. Ship one real order, enter its AWB, and open Track Order as that customer.
   Tracking is refreshed at most every 30 minutes per order.
6. No Shiprocket webhook is used (none is needed for this).

## 7. Hosting environment variables

See `.env.example`. Public: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
Server only: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`RAZORPAY_*`, `CRON_SECRET`, `ONEAPI_SMS_*`, `PHONE_OTP_SECRET`, `SHIPROCKET_*`. The service-role key bypasses all database security rules;
keep it out of `VITE_` variables, browser code, logs and commits.

## 8a. Wishlist, reviews and contact form

- **Wishlist**: saved to the customer's account; nothing to configure.
- **Reviews**: only customers with a *Delivered* order containing the product can review it
  (one review per product, editable). The name shown comes from their profile. Reviews are
  published immediately; hide or show them in **Admin -> Support -> Product reviews**. The
  product's star rating and review count follow the published reviews from the first new
  review on. If the current ratings in the products table are placeholders, reset them once
  in the SQL editor: `update public.products set rating = 0, review_count = 0 where id not in (select product_id from public.product_reviews where status = 'published');`
- **Contact form**: messages are saved to **Admin -> Support**. No email is sent to the shop
  or the customer (no email service is configured for this). Limits: 5 messages per hour per
  email address and per IP address, 200 per hour in total. The per-IP limit needs the hosting
  platform to pass the visitor's IP (`cf-connecting-ip`, `x-real-ip` or `x-forwarded-for`).

## 8b. Product images (Storage bucket `product-images`)

The bucket and its rules were created in the dashboard and were never part of this
repository, so their live state is unknown until checked.

1. **Before** applying the migration, run `supabase/verification/40_product_images_storage_read_only.sql`
   and keep the result: it shows whether the bucket is public and every policy on it (for
   example one that lets *any* signed-in user upload).
2. Apply `20261028091000_product_images_storage.sql` (part of the single migration sequence in section 1). Afterwards only admins (`public.user_roles`)
   can upload, replace or delete product images; signed-out visitors and customers cannot, even
   if an older, looser dashboard policy still exists (the new rules are *restrictive*). Uploads
   are limited to 5 MB JPEG/PNG/WebP/GIF/AVIF (no SVG). Other buckets are not affected.
3. Run the check script again: every `ok` should be `true`.
4. Test in the admin panel: upload an image to a product as the admin; signed in as a customer
   you cannot upload (Storage answers with an error).

**Public or private bucket?** Product images are shown to every visitor, so the bucket can be
public. The migration does **not** change an existing bucket's setting. The admin form works
either way: if the bucket serves public links, new images are saved with a normal public link;
if it is private, they get a 10-year signed link as before.

To make it public (recommended): Storage -> `product-images` -> Edit bucket -> Public, or
`update storage.buckets set public = true where id = 'product-images';`.
Effect: anyone with an image's link can view it (as today with signed links); uploads, changes
and deletions stay admin-only; file listing is not opened by this. Check that a product image
still shows on the storefront afterwards. Then, optionally, replace existing 10-year signed links
with public links (only after the bucket is public):

```sql
update public.products p set
  image_url = regexp_replace(p.image_url, '/object/sign/product-images/([^?]+)\?.*$', '/object/public/product-images/\1'),
  images = (select array_agg(regexp_replace(u, '/object/sign/product-images/([^?]+)\?.*$', '/object/public/product-images/\1') order by n)
            from unnest(p.images) with ordinality as t(u, n))
where p.image_url like '%/object/sign/product-images/%'
   or array_to_string(p.images, ' ') like '%/object/sign/product-images/%';
```

"Remove" in the product form only takes an image off the product; the file stays in storage.

## 8. After go-live

- Place a Cash on Delivery test order; check it in the admin panel; ship it.
- Nothing extra to run: `20261028090500_retire_legacy_order_functions.sql` was applied with
  the other migrations (section 1).
- Investigate the orphaned admin role with
  `supabase/verification/20_orphaned_admin_role_read_only.sql` before deciding whether to
  remove it (instructions at the end of that file).
- Admin roles are granted only by the owner in the SQL editor:
  `insert into public.user_roles (user_id, role) values ('<auth user id>', 'admin');`

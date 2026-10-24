## Store architecture
- Admin operations use authenticated server functions with a database role check before every read or write; customer profiles expose only name and email to administrators.
- Admin password setup uses email-confirmed signup or recovery links; never embed credentials or grant access from client-side email matching.
- Keep the TanStack file-route shell in the root with the shared StoreProvider so cart and wishlist remain synchronized across pages.
- Keep catalogue, variant stock, currency formatting, and total calculations centralized in src/lib/store to avoid inconsistent commerce arithmetic.
- Persist browser state after hydration, validate restored data, and keep order/payment flows separate from production services.
- Reuse store product cards, pricing summaries, accessible Radix dialogs, and design-system buttons throughout the storefront to keep behaviour consistent.
- Define visual styling in the shared semantic CSS design system; route modules own unique page metadata and delegate screen content to focused store modules.
- Keep phone verification attached to the existing email account using Auth phone-change OTP after email confirmation; never create a second phone-only account or silently confirm an email.
- Keep pending mobile verification in tab-scoped storage, never in customer profiles or URL parameters, to preserve profile field limits and avoid leaking contact data.

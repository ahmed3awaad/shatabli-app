# Shatabli — Security audit (2026-10-16)

**Stack:** static site (HTML/JS, no build) on GitHub Pages · Supabase (Postgres + Auth) · supabase-js from jsDelivr.
There is no custom server: every protected operation is enforced in Postgres (RLS, column grants, triggers, `SECURITY DEFINER` functions).

## Findings by severity
| Sev | Finding | Status |
|---|---|---|
| High | Customers could read a craftsman's phone/address-linked profile by sending a request (even pending) → phone harvesting | **Fixed** in `supabase/004_security.sql` (visible only after accept) — *needs to be run* |
| High | No limit on requests → spam/abuse of craftsmen | **Fixed** in `004_security.sql` (8/hour per customer, 3 open per craftsman) — *needs to be run* |
| Medium | Craftsmen could write any URL into `photo_url` (tracking/mixed content) | **Fixed** in `004_security.sql` (column grant revoked) |
| Medium | No Content-Security-Policy; inline scripts present | **Fixed**: CSP `<meta>` in `index.html`, inline scripts/handlers removed (`app.js`) |
| Medium | CDN script loaded without integrity check | **Fixed**: SRI hash + `crossorigin` on supabase-js |
| Low | supabase-js 2.45.4 bundles auth-js with advisory GHSA-8r88-6cj9-9fh5 (low) | **Fixed**: upgraded to 2.117.2 |
| Low | DB-driven CSS class / icon / image names not allow-listed | **Fixed**: `tint()`, `icSafe()`, `taskImg()` allow-lists in `app.js` |
| Low | Craftsman saw customer phone before accepting | **Fixed** in `app.js` |
| Info | No secrets found in working trees or full git history of both repos (only the publishable key, by design) | OK |

## The 20 requirements
| # | Requirement | Status |
|---|---|---|
| 1 | Hide API keys | ✅ Only the publishable key ships; no private keys exist in the project |
| 2 | Purge git secrets | ✅ Scanned files + full history of `shatabli-app` and `shatabli`: none found. Nothing to rotate |
| 3 | Public DB keys only | ✅ `sb_publishable_…` only; test asserts it |
| 4 | RLS | ✅ Enabled on every table with per-row policies |
| 5 | Encrypt sensitive data | ✅ TLS in transit (HTTPS/HSTS); Supabase encrypts at rest. Only name/phone/area/address stored |
| 6 | Server-side auth | ✅ All writes go through RLS / grants / triggers / RPCs that check `auth.uid()`; UI checks are cosmetic only |
| 7 | Lock record access | ✅ Requests/profiles readable only by owner, the other party, or admin |
| 8 | Block field tampering | ✅ Column-level grants (e.g. only `status` updatable on requests); triggers force price/status/kind; ratings/approval protected |
| 9 | Secure session cookies | ⚠️ N/A as cookies: Supabase Auth stores the session in `localStorage` (no server to set HttpOnly cookies). Mitigated by strict CSP + escaping. JWT expiry/refresh set in Supabase |
| 10 | Hash passwords | ✅ Handled by Supabase Auth (bcrypt). Check min length in dashboard (see below) |
| 11 | Rate-limit login | ⚠️ Supabase Auth has built-in rate limits — **review them in the dashboard**. App-level request limits added in DB |
| 12 | Bot protection | ❌ Not yet. Needs a CAPTCHA (Cloudflare Turnstile or hCaptcha) configured in Supabase Auth + a small app change |
| 13 | Parameterized queries | ✅ PostgREST parameters + PL/pgSQL with no dynamic SQL |
| 14 | Validate input | ✅ DB `check` constraints on lengths, ranges, enums, phone format; app trims/normalizes |
| 15 | Escape user content | ✅ Every DB/user string goes through `esc()`; toasts use `textContent`; CSP blocks inline script |
| 16 | Restrict file uploads | N/A — no uploads exist (photo URLs disabled) |
| 17 | Trim API responses | ✅ Passwords/tokens never leave Supabase Auth; private tables not readable anonymously. Public craftsman cards are public by design |
| 18 | Security headers | ⚠️ CSP + Referrer-Policy via `<meta>` (GitHub Pages can't set headers). `_headers` file ready for Cloudflare Pages/Netlify (adds X-Frame-Options, nosniff, Permissions-Policy). Supabase API CORS can't be narrowed on this plan; RLS is the control |
| 19 | Force HTTPS | ✅ GitHub Pages: `https_enforced=true`, HTTP→301, HSTS present |
| 20 | Scan dependencies | ✅ One dependency (supabase-js, pinned + SRI). Advisory found and fixed by upgrade |

## Tests run
- `python3 tests/security_test.py` → **11 passed, 0 failed** (anonymous checks).
  Logged-in checks (role escalation, other users' data, price/status tampering, self-approval, phone validation) are written but **not run yet** — they need two test accounts (see below).
- Secret scan of files + git history: no secrets.
- GitHub Pages HTTPS check: enforced, HSTS present.
- GitHub advisory DB for supabase-js / auth-js: 1 low advisory → fixed by upgrade.
- Guest walkthrough in a browser with CSP + SRI active: home, services, trade list, sign-in redirect — no CSP violations.

## Manual steps needed
1. **Run `supabase/004_security.sql`** in Supabase SQL Editor (non-destructive).
2. Supabase → Authentication → **Policies/Passwords**: minimum length 8; enable *leaked password protection* if your plan has it.
3. Supabase → Authentication → **Rate Limits**: review sign-up / sign-in / OTP limits.
4. Supabase → Authentication → **URL Configuration**: set Site URL to `https://ahmed3awaad.github.io/shatabli-app/`.
5. Before public launch: turn **Confirm email** back on with a real SMTP provider; add **CAPTCHA** (Turnstile) in Auth settings and ask for the app change.
6. To run logged-in tests: create two throwaway accounts, then
   `SHB_A_EMAIL=… SHB_A_PASS=… SHB_B_EMAIL=… SHB_B_PASS=… python3 tests/security_test.py`

## Remaining risks before launch
1. No CAPTCHA on sign-up (bot sign-ups possible) — High for public launch.
2. Logged-in security tests not yet executed — run them.
3. Session in `localStorage` (standard for Supabase SPAs) — an XSS would expose it; mitigated by CSP + escaping.
4. No real security headers beyond CSP on GitHub Pages — consider Cloudflare Pages.
5. Get an independent penetration test before any online payments.

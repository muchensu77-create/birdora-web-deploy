# Birdora UI/API Audit 2026-06-30

## Scope

- Local public site: `http://127.0.0.1:4175`
- Local auth API: `http://127.0.0.1:4101`
- Auth data: isolated temp SQLite database under `%TEMP%`
- Reviewed flows: login/register, mobile home, image identify, community feed/comments

Screenshots were saved locally under `audit/ui-a11y-20260630/` and are intentionally not part of the branch commit.

## Fixed In This Pass

1. Homepage atlas search, post title, and post body controls now have stable accessible names via `aria-label`.
2. Community comment toggles now expose `aria-expanded`, `aria-controls`, and a post-specific accessible label.
3. Auth cookies now derive `maxAge` from the JWT `expiresAt` value instead of always using seven days.

## Verification

- `pnpm sync:public`
- `node --check script.js`
- `node --check public/script.js`
- `node --check app/controllers/auth.controller.js`
- `node --check app/routes/auth.routes.js`
- `node --check server.js`
- `git diff --check`
- Browser audit check:
  - homepage unlabeled controls: `0`
  - first community comment toggle before click: `aria-expanded="false"`
  - first community comment toggle after click: `aria-expanded="true"`
  - controlled comment panel exists in both states
- `AUTH_BASE_URL=http://127.0.0.1:4101 pnpm test:auth`
- Cookie expiry check with `JWT_EXPIRES_IN=1h`: `Max-Age=3599`, `HttpOnly=true`, `SameSite=Lax`
- `pnpm test:atlas`

## Remaining Notes

- `pnpm test:atlas` passes with the existing warning that `bird_info.json` contains 10,964 labels while the OSEA model has been observed returning 11,000 logits.
- Mobile screenshots did not show horizontal overflow in the audited flows.
- The tracked `assets/` and `public/assets/` directories currently duplicate large model/runtime assets; this is a repository-size risk, not changed in this pass.
- `styles.css` has multiple later override sections. Future visual changes should be placed near the existing late responsive repair rules to avoid accidental overrides.

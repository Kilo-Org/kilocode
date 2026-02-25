# Authentication / Organization / Enterprise Enforcement

**Priority:** P1
**Status:** 🔨 Partial

## What Exists

- Full device auth flow UI with QR code, verification code, countdown, copy/open actions in `DeviceAuthCard.tsx`
- Profile page with user header, org switching via `setOrganization`, balance display, dashboard link, logout in `ProfileView.tsx`
- Auth methods: `removeAuth()`, `oauthAuthorize()`, `oauthCallback()`, `getProfile()`, `setOrganization()`

## Remaining Work

- Dropdown to choose between org or personal account, passing the selection via `kilo serve` to the backend when using the Kilo gateway
- Organization feature flags (restrict features based on org plan/tier)
- MDM policy enforcement (managed device policies, enterprise admin controls, restriction enforcement)

# PostHog Person Identification — Current State & Gaps

## How PostHog Person Profiles Work

- Person profiles are created/updated when `identify()` is called or `$set` properties are sent
- `$set` replaces existing property values; `$set_once` only sets if never set before
- Anonymous events don't create/update person profiles
- PostHog recommends passing all available person properties each time you call `identify()`

## Current Implementation (`packages/kilo-telemetry/`)

### Distinct ID

`packages/kilo-telemetry/src/identity.ts:38-40`:

```ts
export function getDistinctId(): string {
  return userId || machineId || "unknown"
}
```

- **Anonymous users**: random UUID persisted to `<dataPath>/telemetry-id` (the `machineId`)
- **Authenticated users**: user's **email address** from `/api/profile`

### When `identify()` is called

`packages/kilo-telemetry/src/telemetry.ts:80-96`:

```ts
export async function updateIdentity(token: string | null, accountId?: string): Promise<void> {
  const previousId = Identity.getDistinctId()
  await Identity.updateFromKiloAuth(token, accountId)

  const email = Identity.getUserId()
  if (email && previousId && email !== previousId) {
    Client.identify(email, {
      ...(accountId && { kilocodeOrganizationId: accountId }),
      appName: props.appName,
      appVersion: props.appVersion,
      platform: props.platform,
    })
    Client.alias(email, previousId)
  }
}
```

| Trigger                     | File                                     | Line | Notes                                                                              |
| --------------------------- | ---------------------------------------- | ---- | ---------------------------------------------------------------------------------- |
| CLI startup (existing auth) | `packages/opencode/src/index.ts`         | 119  | Only if Kilo auth credentials exist                                                |
| OAuth callback (login)      | `packages/opencode/src/provider/auth.ts` | 119  | After successful Kilo OAuth                                                        |
| Logout                      | `packages/opencode/src/auth/index.ts`    | 71   | Calls `updateIdentity(null)` — does NOT trigger `identify()` because email is null |

### Person properties currently set via `$set`

| Property                 | Value                               |
| ------------------------ | ----------------------------------- |
| `kilocodeOrganizationId` | OAuth accountId (optional)          |
| `appName`                | `"kilo-cli"`, `"kilo-vscode"`, etc. |
| `appVersion`             | e.g. `"1.2.3"`                      |
| `platform`               | `"darwin"`, `"linux"`, `"win32"`    |

### Profile API response

`packages/kilo-gateway/src/api/profile.ts:23-35` — returns:

```ts
{
  email: string
  name?: string
  organizations?: Organization[]
}
```

**No user ID field is returned.**

`packages/kilo-gateway/src/types.ts:27-31`:

```ts
export interface KilocodeProfile {
  email: string
  name?: string
  organizations?: Organization[]
}
```

## Gaps / Issues

### 1. No `kilo_user_id` person property

There is no stable user ID in the system. The distinct ID is the user's **email**, which is fragile (emails can change). The backend **does** expose a stable `user.id` in the `/api/profile` response (confirmed from the legacy codebase where `ProfileData.user.id: string` is present), but the current `KilocodeProfile` type in `packages/kilo-gateway/src/types.ts` does not include it.

### 2. `identify()` skips re-login as same user

The guard `email !== previousId` means if a user logs out and back in with the same email, `identify()` is not called again. This means updated person properties (e.g. new `appVersion`) won't be synced.

### 3. Missing person properties

Available but not being set:

| Property       | Source                   | Notes                                         |
| -------------- | ------------------------ | --------------------------------------------- |
| `$email`       | profile API              | PostHog special property, shown in People UI  |
| `$name`        | profile API `name` field | PostHog special property, currently discarded |
| `kilo_user_id` | `user.id` from profile API | Backend already returns it; needs `KilocodeProfile` type update and wiring into `identify()` |

### 4. No `$set_once` usage

No first-seen properties are tracked (e.g. first login date, initial app version).

## What the legacy codebase does (`../kilocode-legacy-5`)

### Profile API response includes `user.id`

`packages/types/src/vscode-extension-host.ts:1109-1118`:

```ts
export type ProfileData = {
  kilocodeToken: string
  user: {
    id: string
    name: string
    email: string
    image: string
  }
  organizations?: UserOrganizationWithApiKey[]
}
```

The legacy `/api/profile` endpoint (`https://api.kilo.ai/api/profile`) **does** return a `user` object with an `id` field. This is fetched via `axios.get<Omit<ProfileData, "kilocodeToken">>(url, { headers })` in `src/core/webview/webviewMessageHandler.ts:2847`.

### PostHog identification in the legacy code

The legacy extension uses a **webview-side (frontend)** PostHog integration (`posthog-js`). The flow is:

1. **`useKiloIdentity` hook** (`webview-ui/src/utils/kilocode/useKiloIdentity.tsx`):
   - When a `kilocodeToken` is present, posts `fetchProfileDataRequest` to the extension host
   - Receives `profileDataResponse` with `payload.data.user.email`
   - Returns `email || machineId` as the identity string

2. **`TelemetryClient.updateTelemetryState`** (`webview-ui/src/utils/TelemetryClient.ts`):
   - Called from `App.tsx` with `telemetryDistinctId = useKiloIdentity(...)`
   - Calls `posthog.identify(distinctId)` — the `distinctId` is the **user's email**

3. **`App.tsx`**:
   ```ts
   const telemetryDistinctId = useKiloIdentity(apiConfiguration?.kilocodeToken ?? "", machineId ?? "")
   telemetryClient.updateTelemetryState(telemetrySetting, telemetryKey, telemetryDistinctId)
   ```

### Key findings

- The legacy code does **NOT** set `kilo_user_id` as a PostHog person property anywhere in the source
- The `user.id` field from the `/api/profile` response is present in the `ProfileData` type but is **not used for PostHog identification** in the legacy extension
- The legacy `distinctId` is still the **email address** (same fragile approach as the current codebase)
- The `kilo_user_id` string only appears in the legacy codebase in a **database schema document** (`apps/kilocode-docs/pages/contributing/architecture/enterprise-mcp-controls.md`), not in any runtime code

### What the legacy code does differently

| Aspect | Legacy (`kilocode-legacy-5`, VSCode extension) | Current (`kilocode-3`, CLI + `kilo-telemetry`) |
| ------ | ---------------------------------------------- | ---------------------------------------------- |
| PostHog SDK | `posthog-js` (browser, webview) | Node.js `posthog-node` |
| `distinctId` | email (from `/api/profile` `user.email`) | email (from `/api/profile`) |
| `user.id` in profile | ✅ Available (`ProfileData.user.id`) | ❌ Not in `KilocodeProfile` type |
| `kilo_user_id` as person property | ❌ Not set | ❌ Not set |
| `$email` person property | ❌ Not set | ❌ Not set |
| `$name` person property | ❌ Not set | ❌ Not set |
| Re-identify on same-user login | ✅ Always (no `email !== previousId` guard) | ❌ Skipped if same email |

### Conclusion

The backend at `/api/profile` already exposes a stable `user.id`. The current `kilocode-3` codebase just does not include it in the `KilocodeProfile` type or pass it to PostHog. No code in either codebase currently sends `kilo_user_id` as a PostHog person property — this is a gap in both.

## Recommendations

1. **Backend**: The legacy `/api/profile` already returns `user.id` — the current `kilocode-3` backend just needs to expose it via the `KilocodeProfile` type (confirmed from legacy `ProfileData.user.id`)
2. **Types**: Update [`KilocodeProfile`](packages/kilo-gateway/src/types.ts) to include `id` (mirroring legacy `ProfileData.user.id`)
3. **Identity**: Use stable `user.id` as PostHog `distinctId` instead of email (alias the old email-based ID)
4. **Person properties**: Add `$email`, `$name`, `kilo_user_id` (= `user.id`) to the `$set` call in [`updateIdentity()`](packages/kilo-telemetry/src/telemetry.ts)
5. **Re-identify on every login**: Remove the `email !== previousId` guard (legacy code does not have this guard), identify whenever `email` is truthy
6. **Consider `$set_once`**: Track first-seen properties like initial app version, first login date

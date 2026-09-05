# V1 credential import parity boundary

The v2 import path is intentionally host-local. It reads supplied local v1
files, builds an in-memory plan, and reports only source facts and
non-sensitive decisions; neither credentials nor a credential writer are
available over the public HTTP/RPC client.

## Source evidence

- V1 auth records are API, OAuth, or well-known entries. The import decoder in
  `packages/kilo-cli/src/import-v1-config.ts` accepts exactly those source
  shapes.
- The v2 credential schema supports a key plus arbitrary metadata and an OAuth
  value with method ID, refresh/access tokens, expiry, and arbitrary metadata:
  `packages/schema/src/credential.ts`.
- V1 Kilo uses OAuth `accountId` only as its selected organization. Its getter
  returns it only for OAuth
  (`ecccd1f:packages/kilo-gateway/src/server/handlers.ts:getOrganizationId`),
  and the Kilo organization setter writes selected `organizationId` back to
  that OAuth field
  (`ecccd1f:packages/opencode/src/kilocode/server/httpapi/handlers/kilo-gateway.ts:344-356`).
- The v2 Kilo Gateway registers the OAuth method ID `device` and reads
  `metadata.server` plus `metadata.organizationID`
  (`packages/kilo-gateway/src/gateway.ts`, `plugin.ts`).
- The v2 OpenAI provider registers `chatgpt-browser` and reads
  `metadata.accountID`; its v1 Codex equivalent stored and used `accountId`
  for the same request header (`packages/core/src/plugin/provider/openai.ts`,
  `ecccd1f:packages/opencode/src/plugin/openai/codex.ts`).
- The v2 and v1 GitHub Copilot providers both use `device` OAuth and
  `enterpriseUrl` to select the enterprise endpoint
  (`packages/core/src/plugin/provider/github-copilot.ts`,
  `ecccd1f:packages/opencode/src/plugin/github-copilot/copilot.ts`).
- The v2 xAI provider registers `device`; the v1 xAI flow stores only OAuth
  token fields, so no legacy metadata is carried
  (`packages/core/src/plugin/provider/xai.ts`,
  `ecccd1f:packages/opencode/src/plugin/xai.ts`).

## Implemented mapping

- Plain v1 API keys retain the pre-existing public-client key-connect path.
- An API key with v1 string metadata requires the in-process
  `CredentialWriter`; it maps to `Credential.Key` preserving that metadata.
  The public key-connect API has no metadata field, so it is not used here.
- A Kilo OAuth entry is accepted only for normalized integration ID `kilo`,
  explicit `gatewayServer`, and a UUID `accountId` when present. It maps
  refresh/access/expiry unchanged to `Credential.OAuth`, exact method ID
  `device`, the validated explicit server, and `accountId` to
  `organizationID`. An absent v1 account ID becomes explicit personal
  `organizationID: null`.
- Proven v1-to-v2 OAuth mappings are deliberately finite: OpenAI uses
  `chatgpt-browser` with `accountId` renamed to `metadata.accountID`; GitHub
  Copilot uses `device` with only `enterpriseUrl` metadata; xAI uses `device`
  with token fields only. Each still requires the exact registered OAuth method
  in the public inventory before the host writer runs.
- `createCredentialImporter` uses the host's real `Credential.Service.create`;
  that service atomically selects the created credential. The writer is an
  in-process closure returned by the host and is not an API endpoint.
- Before writing, the public integration inventory must contain the target
  integration and its matching key method or exact Kilo OAuth/device method.
  The import receives the same public Location used for plugin activation so
  location-scoped Kilo methods are visible to that inventory.
  Existing credential conflicts still require explicit overwrite permission.

## Deliberate gaps

- No custom v1 Kilo server can be recovered from auth.json: v1 derived it from
  process `KILO_API_URL` or a default. The import refuses Kilo OAuth without an
  explicit validated `gatewayServer`; it never infers a server or maps
  `enterpriseUrl`.
- Generic OAuth, well-known credentials, the OAuth dummy API-key sentinel, and
  malformed entries remain refused. `opencode` OAuth is also refused because
  v2 needs `server` and `orgID` metadata that v1's generic `accountId` and
  `enterpriseUrl` cannot recover. No generic provider-to-method-ID table is
  used. Unsupported provider metadata is refused rather than silently dropped.
- The implementation does not claim provider authorization validity or deployed
  credential compatibility. Tests use isolated profiles and fake/in-memory
  credential values only.

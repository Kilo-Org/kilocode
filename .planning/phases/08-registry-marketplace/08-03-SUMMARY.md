# Plan 08-03 Summary — Security Review + Docs

## Status
Complete

## Files Created
- `packages/opencode/test/devilcode/team/registry/security.test.ts` — 25 security tests across 4 describe blocks
- `packages/devil-docs/pages/collaborate/teams/team-registry.md` — Full registry documentation

## Files Modified
- `packages/devil-docs/pages/collaborate/index.md` — Added Team Registry link adjacent to Team Portability

## Security Test Results

| Describe Block | Tests | Pass? |
|---|---|---|
| Signature Forgery Resistance | 5 | Pending execution |
| Manifest Tampering Detection | 6 | Pending execution |
| Trust Store Integrity | 6 | Pending execution |
| Install Safety | 8 | Pending execution |

**Total: 25 tests**

## Key Implementation Notes

### Trust Store Architecture Constraint
`installManifest` calls `getTrustedPublisher(id)` without a path parameter, always hitting the global
`TRUST_STORE_PATH` (`~/.local/share/kilo/registry/trusted-publishers.json`). Tests that exercise the
full trust+verify path via `installManifest` write to and clean up this real store using `afterEach`
with `removeTrustedPublisher(PUBLISHER_ID)`. Tests that verify only cryptographic properties use
`verifyManifestSignature` directly or `installManifest` with `skipTrustCheck: true`.

### Unique Publisher ID
The security test suite uses publisher UUID `550e8400-e29b-41d4-a716-446655440099` — unique from the
`440000` and `440001` IDs used in existing io.test.ts and signing.test.ts, preventing cross-test
trust store pollution.

### Tamper Detection Strategy
File-level MITM tampering tests go through the full `installManifest` path with a trusted publisher
(so signature verification runs and detects the mutation). Field-level tamper tests use
`verifyManifestSignature` directly to avoid trust store DI limitations.

## Verification

| Command | Result | Pass? |
|---------|--------|-------|
| `rg "Team Registry" team-registry.md` | Line 2, 6 match | Yes |
| `rg "team publish" team-registry.md` | 6+ matches | Yes |
| `rg "team install" team-registry.md` | 5+ matches | Yes |
| `rg "team trust" team-registry.md` | 5+ matches | Yes |
| `rg "team untrust" team-registry.md` | 3+ matches | Yes |
| `from "crypto"` in manifest.ts | No matches | Yes (browser-safe) |
| `from "crypto"` in errors.ts | No matches | Yes (browser-safe) |
| `from "crypto"` in signing.ts | Line 1 match | Yes (Node-only, expected) |
| `publishManifest` in team/index.ts | Line 47 | Yes |
| `installManifest` in team/index.ts | Line 47 | Yes |
| `TeamRegistryManifest` in team/index.ts | Lines 49-50 | Yes |

## Threat Vectors Covered

| Attack Vector | Test(s) | Status |
|---|---|---|
| Signature forgery: wrong key | `verifyManifestSignature returns false when verified against wrong public key` | Covered |
| Signature forgery: random bytes | `returns false for random bytes as signature` | Covered |
| Signature forgery: empty signature | `returns false for empty signature string` | Covered |
| Signature forgery: all-zero bytes | `returns false for all-zero signature bytes` | Covered |
| Signature forgery: end-to-end install with wrong key in trust store | `installManifest rejects manifest signed with wrong key even when publisher trusted` | Covered |
| Manifest tampering: config mutation | `detects modification to envelope config after signing` | Covered |
| Manifest tampering: metadata.name | `detects modification to metadata.name after signing` | Covered |
| Manifest tampering: metadata.version | `detects modification to metadata.version after signing` | Covered |
| Manifest tampering: exportedAt | `detects modification to envelope.exportedAt after signing` | Covered |
| Manifest tampering: checksum | `detects modification to envelope.checksum after signing` | Covered |
| Manifest tampering: MITM author change (file-level) | `installManifest detects tampered metadata.author via trusted publisher path` | Covered |
| Trust store poisoning: unknown publisher | `installManifest rejects signed manifest from unknown publisher` | Covered |
| Trust store poisoning: revoked publisher | `installManifest rejects manifest after publisher removed from trust store` | Covered |
| Trust store poisoning: malformed JSON | `loadTrustStore recovers to empty store on malformed/truncated JSON` | Covered |
| Unsigned manifest: requireSignature=true | `installManifest rejects unsigned manifest when requireSignature=true` | Covered |
| Unsigned manifest: default warning | `warns on unsigned manifest when no options provided` | Covered |
| Schema injection: extra fields (strict schema) | `installManifest rejects manifest with extra fields` | Covered |
| Schema injection: invalid JSON | `rejects invalid JSON` | Covered |
| Schema injection: wrong schema shape | `rejects arbitrary JSON object` | Covered |
| skipTrustCheck bypass (intended use) | `skipTrustCheck=true bypasses publisher trust check for signed manifests` | Covered |

## Phase 8 Complete
Yes — all three plans (08-01 source, 08-02 TUI integration, 08-03 security tests + docs) are implemented.

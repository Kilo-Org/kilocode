# Use SDK Over Direct HTTP Requests

**Priority:** P2
**Status:** 🔨 Partial (assigned)
**Issue:** [#6243](https://github.com/Kilo-Org/kilocode/issues/6243)

## Problem

The extension's `HttpClient` (`src/services/cli-backend/http-client.ts`) makes raw `fetch()` calls to the CLI server. The monorepo already has an auto-generated `@kilocode/sdk` package that provides typed methods for all CLI endpoints. Using the raw HTTP client means:

- No type safety for request/response shapes
- No automatic updates when the CLI API changes (the SDK is regenerated from the server spec)
- Duplicated endpoint URL construction and authentication logic

## Remaining Work

- Replace direct `fetch()` calls in `HttpClient` and `KiloProvider` with `@kilocode/sdk` client methods
- The SDK is already in the monorepo at `packages/sdk/js/`; add it as a dependency if not already present
- Initialize an SDK client instance with the dynamic server URL and auth token in `KiloConnectionService`
- Replace each HTTP call site one by one, verifying correct types at each step
- Remove the now-redundant hand-written response types from `src/services/cli-backend/types.ts` where the SDK provides equivalent types

## Implementation Notes

- The SDK client is generated from the server spec — do not edit `packages/sdk/js/src/gen/` manually
- The SDK client needs the base URL and auth token; these are available from `KiloConnectionService` once the server is started
- SSE subscriptions may not be covered by the SDK; keep the manual `SSEClient` for those

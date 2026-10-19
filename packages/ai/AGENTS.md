# AI Package Guide

## Principles

- **Forward compatibility.** Providers ship new models, options, and values constantly. Accept unknown pass-through values (`Known | (string & {})` for string options); use closed literals only when OpenCode branches on the value.
- **One canonical model.** The Schema classes in `src/schema/` are the data model. Do not add a parallel shape or a second construction path.
- **Independent of Session.** Auth, permissions, plugins, and orchestration belong in Core. `LLM.stream`/`LLM.generate` run exactly one model call.
- **Reuse protocols.** Providers compose existing protocols with `Route.make(...)` instead of cloning them.

## Code style

- Use `HttpClient`, `Stream`, and Schema codecs instead of `fetch`, async generators, and `JSON.parse`/`JSON.stringify`.
- `return yield* new MyError(...)` instead of `Effect.fail(...)`; `Effect.void` instead of `Effect.succeed(undefined)`.
- Only `src/promise.ts` may use Promises.

## Tests

- Use `testEffect(...)` from `test/lib/effect.ts` for tests that need Effect layers.
- Provider tests replay cassettes: recorded HTTP exchanges stored as JSON in `test/fixtures/recordings/`, one file per scenario. Replay is the default and needs no API keys.
- To record, unset `CI` and run with `RECORD=true` plus the provider's API key. Re-record only the cassette you are changing; recordings contain volatile IDs that create noisy diffs.

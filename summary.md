# Together AI provider records 0 tokens / $0.00 cost — Fix Summary

- **Issue**: #46 — "VS Code 7.8.8: no token usage or cost recorded for Together AI provider usage capture regression #14990"
- **Branch**: `aifix/zytest/issue-46-auto` → target `chore/remove-opencode-dir`
- **Final conclusion**: The pinned `@ai-sdk/togetherai@2.0.41` SDK builds its chat model without `includeUsage`, so the streaming request never carries `stream_options: {include_usage: true}` and Together AI returns no final `usage` chunk — fixed by patching the pinned SDK so its chat model requests usage.

## Modified files

| File | What changed and why |
|---|---|
| `patches/@ai-sdk%2Ftogetherai@2.0.41.patch` | **New.** Bun dependency patch that injects `includeUsage: true` into `createChatModel` of the pinned Together AI SDK (3 files: `dist/index.js`, `dist/index.mjs`, `src/togetherai-provider.ts`). Header comment records the root cause, why the flag cannot be enabled from Kilo code, the upstream 2.0.68 equivalent, and the removal condition. |
| `package.json` | Registers `"@ai-sdk/togetherai@2.0.41": "patches/@ai-sdk%2Ftogetherai@2.0.41.patch"` in `patchedDependencies` so Bun applies the patch at install time. |
| `bun.lock` | Adds the same single entry to the lockfile `patchedDependencies` map (1 insertion, 0 deletions) so the patch is part of the frozen install. |
| `packages/opencode/test/kilocode/together-usage.test.ts` | **New.** SDK-level regression test: all three Together AI routes (`provider`, `chatModel`, `languageModel`) must send `stream_options: {include_usage: true}` and surface the final usage chunk; the non-streaming path must stay unchanged. The mock only emits a usage chunk when the flag is present, so the test fails without the patch. |
| `packages/core/test/plugin/provider-togetherai.test.ts` | Adds the registry import that fixes a pre-existing module-init cycle failure in this file, plus a plugin-level streaming-usage regression test for the `togetherai` and `custom-togetherai` provider IDs. |
| `.changeset/together-streaming-usage.md` | **New.** `@kilocode/cli` patch changeset so the fix ships in the changelog. |

## Risk level

**low**

Main risk points:
- The patch is pinned to exactly `@ai-sdk/togetherai@2.0.41`. If the dependency is bumped, Bun silently stops applying the patch and usage recording regresses. This is mitigated by the repo's existing `packages/opencode/test/patched-dependencies.test.ts` guard, which fails when the installed version no longer matches a pinned patch entry.
- The patch adds `stream_options: {include_usage: true}` to Together AI chat requests. This is the standard OpenAI-compatible usage request and is already used unconditionally by Kilo's own native route (`packages/llm/src/protocols/openai-chat.ts:360`); the repo's recorded Together AI cassette shows the API answering it with HTTP 200 and a usage payload.
- Only the chat model is patched — completion, embedding, image and reranking models are untouched. Dropping the patch in favour of upstream 2.0.68 would additionally turn on usage for completion models.
- No provider source file was modified, so the fork-isolation rule is respected and there is no behavioural asymmetry introduced in Kilo code.

## Review conclusion

**pass_with_comment** (2 rounds)

- Round 1: no blocking issues. Raised one should-fix (patch carried no recorded rationale) and nits (duplicated marker comment, missing `index` blob-hash lines).
- Round 2: all round-1 items verified as correctly fixed. Raised two further items — patch comment imprecise about the upstream 2.0.68 scope, and `it.live` instead of `it.effect` in the new core test. Both were fixed and re-verified.

## Final recommendation

**Ready to merge.** The fix is minimal, contained in the dependency-patch mechanism the repo already uses, covered by two layers of hermetic regression tests, verified by a real CLI build whose bundle contains the patched SDK, and leaves no shared upstream source file modified.

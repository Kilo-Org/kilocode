# Execution Trace

- **Issue IID**: 46
- **Branch**: `aifix/zytest/issue-46-auto` (base `chore/remove-opencode-dir`, package version 7.8.17)
- **Title**: VS Code 7.8.8: no token usage or cost recorded for Together AI provider usage capture regression #14990
- **Attachment path**: `issue-attachments/` — contains only an empty `designs/` folder, so no attachment analysis was needed.

---

## 1. Issue 理解

Since 7.8.8, Kilo records **zero token usage and $0.00 cost for every request through the Together AI provider**. The symptom appears in four surfaces at once: the session header / context bar, the model usage panel, `kilo stats --models`, and the session database (every assistant message stores `tokens {input:0, output:0, reasoning:0, cache:{read:0, write:0}}` and `cost: 0`). Response *text* streams fine, so the failure is isolated to usage accounting, not to the request/response path. Under 7.4.15 the same setup recorded usage correctly (3.2M input, 367K output, 81.3M cache read, 9.04 total cost on GLM-5.2).

Reporter's own hypothesis: the bundled openai-compatible AI SDK model only sends `stream_options: {include_usage: true}` when `config.includeUsage` is set, and the togetherai provider instance is no longer instantiated with `includeUsage` enabled — so the stream never carries usage, and without token counts cost cannot be computed.

Expected behaviour: token counts and cost per models.dev pricing, identical to 7.4.15.

---

## 2. 复现路径与真实调用链

### 原始复现步骤

1. Configure the built-in Together AI provider with an API key (`kilo auth` / `auth.json`).
2. Select a Together AI model (reporter used `togetherai/zai-org/GLM-5.3`, also GLM-5.2 / GLM-5.3-Flash).
3. Run any task.
4. Read the session header / model usage panel, or run `kilo stats --models` -> `0` tokens, `.0000` cost.

### 用户操作/输入 -> 事件/信号 -> 业务入口 -> 状态变化 -> 输出/副作用 -> 错误现象

| # | Stage | Location | State |
|---|---|---|---|
| 1 | user prompt enters the session LLM service | `packages/opencode/src/session/llm.ts:136` `run()` | request prepared, runtime = AI SDK (default) |
| 2 | provider -> SDK instance resolution | `packages/opencode/src/provider/provider.ts:1838` `resolveSDK` -> `BUNDLED_PROVIDERS["@ai-sdk/togetherai"]` (`:154`) -> `createTogetherAI(options)` | `@ai-sdk/togetherai@2.0.41` chat model built **without** `includeUsage` |
| 3 | streaming request | AI SDK `OpenAICompatibleChatLanguageModel.doStream` -> `stream_options: this.config.includeUsage ? {include_usage:true} : undefined` | request body has **no** `stream_options` |
| 4 | provider answer | Together AI only emits the final `usage` chunk when `stream_options.include_usage` was requested | **no usage chunk** in the SSE stream |
| 5 | SDK usage resolution | AI SDK `stream-text.ts` -> `totalUsage = createNullLanguageModelUsage()` -> all fields `undefined` | usage object empty |
| 6 | session adapter | `packages/opencode/src/session/llm/ai-sdk.ts:47-69` `usage()` drops `undefined` entries -> returns `undefined` | `LLMEvent.finish({usage: undefined})` |
| 7 | session processor | `packages/opencode/src/session/processor.ts:669-673` `value.usage ?? new Usage({})` | usage = all zeros |
| 8 | persistence | `packages/opencode/src/session/session.ts:132-167` `toRow` -> `tokens_input/tokens_output/tokens_cache_read/tokens_cache_write`, `cost` | DB row = 0 / 0 |
| 9 | aggregation | `packages/opencode/src/session/session.ts:420-502` `Session.getUsage()` — cost = `model.cost.* x token counts` | cost = $0 (0 tokens => $0) |
| 10 | presentation | `packages/opencode/src/kilocode/session/model-usage.ts` -> session header counter, message footer, `kilo stats --models` | `0` tokens, `.0000` |

The same SDK instance is also reachable through the migrated core plugin path `packages/core/src/plugin/provider/togetherai.ts:11` (`mod.createTogetherAI(evt.options)`), which is why the fix was placed at the SDK level and covers both consumers.

### 拟修改点是否必经

**是.** The only place `includeUsage` can be turned on for a Together AI *chat* model is the construction of the underlying `OpenAICompatibleChatLanguageModel`, which happens inside `@ai-sdk/togetherai`'s `createChatModel`. Evidence:

- Probe against the installed (unpatched) SDK in the `packages/opencode` workspace with a mocked `fetch`: request body = `{"model":"m","messages":[...],"stream":true}` — **no** `stream_options`; `finish` part usage = `{"inputTokens":{},"outputTokens":{}}`.
- Same probe **with** `includeUsage: true` passed into `createTogetherAI({apiKey, includeUsage:true})`: request body was **still** `{"model","messages","stream":true}` and usage still empty -> the SDK silently drops the unknown option. This empirically refutes the "just set the provider option" remedy.
- After the fix the same probe produced `"stream_options": {"include_usage": true}` in the request body.

---

## 3. 假设、证据与根因分析

### 根因假设列表

| ID | 假设 | 状态 | 关键证据 |
|---|---|---|---|
| H1 | `@ai-sdk/togetherai@2.0.41` never sets `includeUsage` on the compatible chat model, so `stream_options` is never sent | **已证明** | npm tarball `src/togetherai-provider.ts`: `TogetherAIProviderSettings` = `{apiKey, baseURL, headers, fetch}` (no `includeUsage`); `createChatModel` -> `new OpenAICompatibleChatLanguageModel(modelId, getCommonModelConfig('chat'))`; `getCommonModelConfig` returns only `{provider, url, headers, fetch}` |
| H2 | Kilo's provider layer never enables `includeUsage` for `@ai-sdk/togetherai` | **已证明** | `packages/opencode/src/provider/provider.ts:1860` gates on `model.api.npm.includes("@ai-sdk/openai-compatible")` (does not match `@ai-sdk/togetherai`); `packages/core/src/plugin/provider/openai-compatible.ts:11` has the same gate and `packages/core/src/plugin/provider/togetherai.ts` has none |
| H3 | Setting `includeUsage: true` through provider options would fix it | **已证伪** | Probe: `createTogetherAI({apiKey, includeUsage:true})` -> body still had no `stream_options`; the SDK builds an explicit config object and drops unknown keys |
| H4 | Together AI returns usage when `stream_options.include_usage` is set | **已证明（仓库内证据）** | Repo recording `packages/llm/test/fixtures/recordings/openai-compatible-chat/togetherai-streams-text.json` shows HTTP 200 for a body carrying `"stream_options":{"include_usage":true}` and a response containing `prompt_tokens/completion_tokens/total_tokens`; Kilo's own native route sends it unconditionally (`packages/llm/src/protocols/openai-chat.ts:360`). Reporter's `curl` against `api.together.xyz` corroborates |
| H5 | Pricing / models.dev catalog problem | **已证伪** | Catalog entry carries `cost {input:1.4, output:4.4, cache_read:0.26}`; cost is derived from token counts (`packages/opencode/src/session/session.ts:420-502`), so 0 tokens => $0 regardless of pricing |
| H6 | Provider API / model-specific problem | **已证伪** | Reporter's direct `curl` returns usage; text streams fine through Kilo; failure is version-wide (GLM-5.2/5.3/5.3-Flash, both CLI and VS Code) |
| H7 | The native `@opencode-ai/llm` runtime is the path that should be fixed | **已证伪** | `packages/opencode/src/session/llm.ts:346` uses native only when `flags.experimentalNativeLlm` is on (`KILO_EXPERIMENTAL_NATIVE_LLM`, default off), and `packages/opencode/src/session/llm/native-runtime.ts:56-60` rejects any provider outside openai/anthropic/opencode*. The native route already sends `stream_options: {include_usage:true}` |

### 改前证据门禁

**是 — 原始问题路径必经拟修改点。** The probe captured the actual outgoing request body produced by the Together AI chat model used by the session LLM service and showed the missing `stream_options`; after the change the same request body carries it. The patched SDK is the object the session LLM service ultimately invokes (`provider.ts:154` -> `createTogetherAI` -> `OpenAICompatibleChatLanguageModel.doStream`).

### 每个关键假设的改前证据

- H1/H2/H3: npm tarball of `@ai-sdk/togetherai@2.0.41` (`src/togetherai-provider.ts:28-46, 143-155`) + `@ai-sdk/openai-compatible@2.0.48` (`src/chat/openai-compatible-chat-language-model.ts:50, 387-390`) + repo call sites `provider.ts:154, 1860` and `core/src/plugin/provider/togetherai.ts:11` + live probe.
- H4: repo recorded cassette + `packages/llm/src/protocols/openai-chat.ts:360`.
- H5/H6: `packages/opencode/src/session/session.ts:420-502` (cost = price x tokens).

### 每个关键假设的反证条件

- H1 falsified if the installed `createChatModel` already passed `includeUsage` -> probe showed `stream_options` absent => H1 holds.
- H3 falsified if passing `includeUsage: true` had produced `stream_options` -> probe showed it did not => H3 holds (remedy rejected).
- H4 falsified if Together AI answered the flagged request with an error or without usage -> the repo recording shows 200 + usage, and the request shape is the standard OpenAI-compatible one => H4 holds.
- H5 falsified if `model.cost` were empty for the Together AI models -> catalog entry has costs, and cost is a function of tokens => H5 rejected.

### 排除的错误假设

Pricing/catalog (H5), provider/API health (H6), model-specific behaviour, and "route it through the native runtime" (H7) are all excluded.

### 最终根因

`@ai-sdk/togetherai@2.0.41` constructs its chat model as `new OpenAICompatibleChatLanguageModel(modelId, getCommonModelConfig('chat'))`, and `getCommonModelConfig()` returns only `{provider, url, headers, fetch}` — the `includeUsage` flag is never forwarded. `@ai-sdk/openai-compatible` only emits `stream_options: {include_usage: true}` when `config.includeUsage` is truthy, so Together AI never sends the final `usage` chunk. The AI SDK then resolves usage as all-undefined, Kilo's session pipeline persists zeros, and cost — being computed from token counts — is $0. Kilo's own provider layer cannot compensate, because the SDK's provider-settings type has no `includeUsage` field and unknown options are dropped. The fix must therefore live in the SDK, and the repository's established mechanism for that is a Bun `patchedDependencies` patch.

---

## 4. 问题域与状态分层

| 问题域 | 是否涉及 | 映射到的真实证据类型 |
|---|---|---|
| UI 事件 | 否（UI 只是呈现层） | — |
| signal-slot | 否 | — |
| QObject 生命周期 | 否（非 Qt 工程） | — |
| 线程 affinity | 否 | — |
| Model-View | 否 | — |
| 异步回调 / SSE | **是** | Together AI 的最后一个 SSE chunk 是否带 `usage` |
| 定时器 | 否 | — |
| 配置 | **是** | 依赖版本钉住 + `patchedDependencies` 注册 |
| 外部 API | **是** | `api.together.xyz/v1/chat/completions` 的请求体契约 |
| 绘制布局 | 否 | — |

**状态分层**

| 状态层 | 具体内容 | 修复前取值 | 修复后取值 |
|---|---|---|---|
| 外部系统状态 | Together AI 是否回传 usage chunk | 不回传（未请求） | 回传（已请求） |
| 请求体 (wire) | `stream_options` | 缺失 | `{include_usage: true}` |
| model 数据 | assistant message `tokens` / `cost` | 全 0 | 真实 token 数 / 真实 cost |
| 业务状态 | `Session.getUsage()` 聚合 | 全 0 | 真实聚合 |
| 持久化配置 | session DB `tokens_input/output/cache_read/cache_write` + `cost` | 0 | 真实值 |
| UI 显示状态 | session header 计数、消息 footer、model usage panel、`kilo stats --models` | `0` / `.0000` | 真实值 |
| 缓存 / 本地句柄 | 本次不涉及缓存或句柄生命周期 | — | — |

**状态之间如何同步，证据是什么**：SSE 最后一个 chunk -> AI SDK `doStream` 的 `finish` part -> `packages/opencode/src/session/llm/ai-sdk.ts:47-69` 转 `LLMEvent` -> `packages/opencode/src/session/processor.ts:669-673` 归一为 `Usage` -> `packages/opencode/src/session/session.ts:132-167` 落库 -> `packages/opencode/src/session/session.ts:420-502` 聚合 -> UI 读取。usage 缺失在这一链条上被 `?? new Usage({})` 静默降级为 0，这正是"不报错但全是 0"的原因。

---

## 5. 方案选择与理由

### 最小修复方案

用仓库既有的 Bun `patchedDependencies` 机制，为钉住的 `@ai-sdk/togetherai@2.0.41` 打一个补丁，让它的 chat model 以 `includeUsage: true` 构造：

```
-      getCommonModelConfig("chat")
+      { ...getCommonModelConfig("chat"), includeUsage: true }
```

只改 `createChatModel` 一处（`dist/index.js` / `dist/index.mjs` / `src/togetherai-provider.ts` 三个文件），completion / embedding / image / reranking 模型完全不动。**不修改任何 `packages/*/src/` 文件**，因此不触发 fork-isolation 规则，也不需要 `kilocode_change` 标记。

### 为什么不是只修表象

| 备选 | 为什么被否 |
|---|---|
| 在 provider option 里传 `includeUsage: true` | **已实证无效**。`TogetherAIProviderSettings` 无此字段，`getCommonModelConfig()` 构造显式对象，未知键被丢弃；探针证明请求体不变 |
| 把 Together AI 换成 `createOpenAICompatible` | 会丢掉 `imageModel` / `rerankingModel` / embedding 模型（openai-compatible 没有 reranking），改变 UA / header / 错误形状，且要改两个调用点（`provider.ts:154`、`core/src/plugin/provider/togetherai.ts:11`），违反 fork-isolation |
| 在 provider 级 `fetch` 包装里改写 JSON body 注入 `stream_options` | 要动两处互相独立的包装（`provider.ts:1909-1952`、`core/src/aisdk.ts:74-122`），body 未必是字符串，且会污染所有经过该包装的其它 provider；对 SDK 外部消费者无效 |
| 用 AI SDK middleware / 自定义 model loader 覆盖 | AI SDK v6 的 `transformParams` 拿到的是 `LanguageModelV3CallOptions`（prompt/headers/providerOptions），不是最终 JSON body，注入不到 `stream_options`；自定义 loader 要重写 auth/header/baseURL，且只能覆盖 opencode 一侧、覆盖不到 core plugin 一侧 |
| 走 native runtime | 需要 `KILO_EXPERIMENTAL_NATIVE_LLM`（默认关），且 native gate 直接拒绝非 openai/anthropic/opencode* 的 provider；native 侧本来就已经无条件发送 `stream_options` |
| 直接升级到 2.0.68（上游已修） | 会连带引入 `@ai-sdk/provider` 3.0.8->3.0.14、`provider-utils` 4.0.21->4.0.40、`openai-compatible` 2.0.37->2.0.62，与仓库钉住的版本族存在类型/运行时偏移风险。**保留补丁**，但在补丁头部写明上游等价修复的版本号与移除条件 |

### 反例/负向场景设计

- **必须失败的反例**：mock 的 `fetch` **只在** 请求体含 `stream_options.include_usage` 时才吐出 usage chunk。因此在未打补丁的 SDK 上测试必然失败（`stream_options` 为 `undefined`），打补丁后通过 —— 这是真回归测试而非同义反复。已实测：还原 node_modules 中的补丁后 `together-usage.test.ts` 3/4 失败、`provider-togetherai.test.ts` 1/5 失败。
- **不得回归的反例**：非流式路径断言 `requests[0]?.stream_options` 为 `undefined` 且 usage 仍来自响应体，确保补丁没有给 `doGenerate` 也加上 `stream_options`（`@ai-sdk/openai-compatible` 只在 `doStream` 里加）。
- **范围反例**：patched-dependencies 守卫保证一旦版本漂移、补丁静默失效，测试立即红。

---

## 6. 文件修改记录

### 文件：`patches/@ai-sdk%2Ftogetherai@2.0.41.patch`（新增）
- **修改位置**：新增文件；hunk 分别位于 `dist/index.js:318`、`dist/index.mjs:313`、`src/togetherai-provider.ts:150` 的 `createChatModel`。
- **修改理由**：`includeUsage` 是 `@ai-sdk/openai-compatible` 唯一能触发 `stream_options: {include_usage: true}` 的开关，而 `@ai-sdk/togetherai@2.0.41` 既不暴露该 provider setting、也不向底层 chat model 透传它，只能在 SDK 内部修复。
- **具体改动**：`getCommonModelConfig("chat")` -> `{ ...getCommonModelConfig("chat"), includeUsage: true }`（三个文件各一处）。补丁头部为 `#` 注释块，记录根因、为何无法从 Kilo 代码开启、上游 2.0.68 的等价修复及其额外开启 completion usage 的差异、以及移除条件。三个 hunk 带 `index <old>..<new> 100644` blob 哈希行，与仓库其它 patch 文件风格一致（哈希经 `git hash-object` 复核）。

### 文件：`package.json`（修改）
- **修改位置**：根 `patchedDependencies` 映射（约 194 行）。
- **修改理由**：Bun 只在 `patchedDependencies` 中登记的 `name@version` 上应用补丁。
- **具体改动**：新增 `"@ai-sdk/togetherai@2.0.41": "patches/@ai-sdk%2Ftogetherai@2.0.41.patch"`，并给上一行 `bun-pty@0.4.8` 补上尾逗号。

### 文件：`bun.lock`（修改）
- **修改位置**：根 `"patchedDependencies"` 映射（`bun.lock:1017-1037`）。
- **修改理由**：锁文件必须与 `package.json` 的补丁登记一致，`bun install --frozen-lockfile` 才不会重写补丁表。
- **具体改动**：新增一行 `"@ai-sdk/togetherai@2.0.41": "patches/@ai-sdk%2Ftogetherai@2.0.41.patch",`。**注意**：沙箱 npm 走镜像源，`bun install` 会把整个 lockfile 重写成镜像 URL（2560 行噪声），因此最终 lockfile 是手工编辑的单行增量（`git diff --numstat bun.lock` = `1 0`）。

### 文件：`packages/opencode/test/kilocode/together-usage.test.ts`（新增）
- **修改位置**：新增文件。
- **修改理由**：SDK 层回归测试，锁定 `provider` / `chatModel` / `languageModel` 三条构造路径都必须请求 usage，并保证非流式路径不受影响。
- **具体改动**：4 个用例。3 个流式用例注入 mock `fetch`，仅当请求体含 `stream_options.include_usage` 时才回吐 usage chunk，断言请求体含 `stream_options: {include_usage: true}` 且 `finish` part 的 usage 为 `inputTokens.total=42 / outputTokens.total=7`；1 个非流式用例断言 `stream_options` 为 `undefined` 且 usage 仍来自响应体。

### 文件：`packages/core/test/plugin/provider-togetherai.test.ts`（修改）
- **修改位置**：文件头（第 1-3 行）新增 registry import；第 26 行新增 `sse` 辅助；第 134 行起新增 `it.effect` 回归用例。
- **修改理由**：(a) 该文件在当前快照中**本身就是坏的**——单独运行报 `ReferenceError: Cannot access 'TogetherAIPlugin' before initialization`（`packages/core/src/plugin/provider.ts:65` 的模块初始化环），按仓库既有做法（`provider-nvidia.test.ts` / `provider-openrouter.test.ts` / `provider-zenmux.test.ts` / `provider-snowflake-cortex.test.ts` / `provider-kilo.test.ts`）在文件头先 import provider registry 即可修复；(b) 需要覆盖 core plugin 路径（`packages/core/src/plugin/provider/togetherai.ts`）也拿到 usage。
- **具体改动**：`import "@opencode-ai/core/plugin/provider"` 加 `kilocode_change` 标记；新增 `it.effect("requests and reads the final usage chunk for bundled and custom provider IDs")`，对 `togetherai` 与 `custom-togetherai` 两个 provider ID 各跑一遍，经 `aisdk.runSDK` 拿到 SDK 后调用 `sdk.languageModel("model").doStream(...)`，断言请求体与 `finish` usage。

### 文件：`.changeset/together-streaming-usage.md`（新增）
- **修改位置**：新增文件。
- **修改理由**：面向用户的修复需要进入 changelog。
- **具体改动**：`"@kilocode/cli": patch` + 一句话描述。`@kilocode/cli` 是唯一发布该依赖的包（`packages/core` 为 `private: true`），且 `kilo-code` 与 `@kilocode/cli` 在 `.changeset/config.json` 的 `fixed` 组内会同步 bump。

---

## 7. 遇到的问题与解决思路

| # | 问题 | 解决思路 |
|---|---|---|
| 1 | 沙箱 npm 使用镜像源，`bun install` 把 `bun.lock` 重写成镜像 URL（2560 行噪声） | 先 `bun install` 让补丁真正落到 node_modules，再 `git checkout -- bun.lock`，最后用脚本手工插入**唯一一行** `patchedDependencies`；最终 `git diff --numstat bun.lock` = `1 0` |
| 2 | `packages/core/test/plugin/provider-togetherai.test.ts` 在当前快照里单独运行即失败（模块初始化环） | 在文件头加 `import "@opencode-ai/core/plugin/provider"`（与仓库其它 provider 测试同款做法），并加 `kilocode_change` 标记以通过 `script/check-opencode-annotations.ts` |
| 3 | 新增 core 用例 typecheck 失败（`stream` / `part` 被推断为 `unknown`） | 用 `const model: LanguageModelV3 = ...` 显式标注替代 `as` 断言，并把 `doStream` 包进 `async` 箭头函数，让 `Effect.promise` 拿到真正的 `Promise`（SDK 返回 `PromiseLike`） |
| 4 | oxlint 对新代码报 `no-unused-vars` / `no-unsafe-type-assertion` | 删除未使用的 `plugin` 绑定、用类型标注替代 `as` 断言；复核后两个测试文件的 lint 命中数与 HEAD 基线完全一致（6 条，全部落在既有行），新文件 0 条 |
| 5 | CLI 构建要求 Bun 1.4.4（`38afee6c8`）与 Zig | 从 npm 拉 `@oven/bun-linux-x64@1.4.4`、从 ziglang.org 拉 Zig 0.14.1，放在 `/tmp/opencode` 下，用 `ZIG=... bun144/.../bun run script/build.ts --skip-install --single` 完成构建 |
| 6 | 首轮 review 指出补丁没有记录"为什么打补丁而不升级依赖" | 在补丁文件头部加 `#` 注释块说明根因、无法从 Kilo 代码开启的原因、上游 2.0.68 等价修复与移除条件；已验证 Bun 与 `git apply` 都忽略该注释块 |
| 7 | 首轮 review 指出 marker 注释重复、缺 `index` 哈希行 | 删除重复的纯注释行；用 `git hash-object` 算出 pristine/patched 哈希并补上 `index` 行，实测哈希与补丁期望一致 |
| 8 | 二轮 review 指出"上游 2.0.68 是同一个修复"表述不精确（上游是超集，同时给 completion 也开了 usage） | 改写注释为"an equivalent fix ... which also enables usage for completion models"，并在移除条件里点明"dropping it then also turns on usage reporting for completion models" |
| 9 | 二轮 review 指出新用例用 `it.live` 与同文件 `it.effect` 风格不一致，且该用例并不涉及 live OS 行为 | 改为 `it.effect`，复跑 5 pass / 0 fail |

---

## 8. 修复验证记录

### 验证点列表

| ID | 验证点 |
|---|---|
| V1 | Together AI chat 请求体带 `stream_options: {include_usage: true }` |
| V2 | 流式响应最后一个 usage chunk 被 AI SDK 解析进 `finish` part 的 usage |
| V3 | `provider` / `chatModel` / `languageModel` 三条构造路径都生效 |
| V4 | core plugin 路径（`togetherai` 与 `custom-togetherai` provider ID）同样生效 |
| V5 | 非流式 `doGenerate` 不受影响（不下发 `stream_options`，usage 仍来自响应体） |
| V6 | completion / embedding / image / reranking 模型不被波及 |
| V7 | 补丁登记与版本钉住一致，版本漂移会被守卫捕获 |
| V8 | 补丁可被 Bun 与 `git apply` 干净应用 |
| V9 | 类型检查、lint、格式、架构/注解守卫全绿 |
| V10 | CLI 可构建，且产物内确实包含打好补丁的 SDK |
| V11 | 回归测试是真回归（去掉补丁必失败） |

### 验证方法（A/B/C/D/E/F/G/H/I/J/K）

- **A** — 直连 SDK 探针：在 `packages/opencode` workspace 内用 mock `fetch` 直接调用 `createTogetherAI(...)` 的 `doStream`，打印请求体与 `finish` part。
- **B** — 新增单元测试：`packages/opencode/test/kilocode/together-usage.test.ts`。
- **C** — 新增单元测试（core plugin 层）：`packages/core/test/plugin/provider-togetherai.test.ts`。
- **D** — 依赖补丁守卫测试：`packages/opencode/test/patched-dependencies.test.ts`。
- **E** — 负向验证：手工把已安装 store 副本中的补丁还原，再跑 B/C，确认测试转红，随后恢复。
- **F** — 静态检查：`bun run typecheck`（opencode / core）、`bunx oxlint`、`bunx prettier --check`。
- **G** — 仓库守卫脚本：`script/check-opencode-annotations.ts --worktree`、`script/check-test-ci.ts`、`script/check-kilocode-duplication.ts`、`script/check-forbidden-strings.ts`。
- **H** — 补丁应用验证：`npm pack @ai-sdk/togetherai@2.0.41` → 解包 → `git apply --check` + `git apply`；并删除 bun store 副本后 `bun install` 验证 Bun 端应用。
- **I** — 全量构建：`ZIG=... bun1.4.4 run script/build.ts --skip-install --single`，含 CLI 版本、models 快照、sandbox worker 三项 smoke test。
- **J** — 产物校验：在 `kilo.map` source map 中检索打补丁后的 Together AI 源码。
- **K** — 回归面：`packages/core` 全量测试、`packages/core/test/plugin/` 全目录测试、`packages/opencode/test/kilocode/` 目录测试。

### 功能级观测对象

1. 出站请求体中的 `stream_options` 字段（wire 层，最直接）。
2. AI SDK `finish` part 的 `usage.inputTokens.total` / `usage.outputTokens.total`。
3. `packages/core` plugin 层 `aisdk.runSDK` 产出的 SDK 所发出的请求体。
4. 构建产物 `dist/@kilocode/cli-linux-x64/bin/kilo` 及其 source map 中内联的 Together AI provider 源码。
5. `bun.lock` / `package.json` 的 `patchedDependencies` 映射一致性。

### 每轮验证结论与证据

| 轮次 | 方法 | 结论 | 证据 |
|---|---|---|---|
| 1（改前基线） | A | **FAIL（复现成功）** | 请求体 `{"model":"m","messages":[...],"stream":true}` 无 `stream_options`；`finish.usage = {"inputTokens":{},"outputTokens":{}}` |
| 1（改前基线） | A（带 `includeUsage:true` 传入） | **FAIL** | 请求体不变 → 证伪"provider option"方案 |
| 2（实施后） | A | **PASS** | 请求体含 `"stream_options":{"include_usage":true}` |
| 2（实施后） | B | **PASS** | `4 pass / 0 fail`（15 expect） |
| 2（实施后） | C | **PASS** | `5 pass / 0 fail`（16 expect） |
| 2（实施后） | D | **PASS** | `23 pass / 0 fail`（含新增的 togetherai 条目） |
| 3（负向验证） | E | **PASS（符合预期地红）** | 还原补丁后 B `3 fail / 1 pass`、C `1 fail / 4 pass`；失败信息为 `stream_options` 期望 `{include_usage:true}` 实得 `undefined` |
| 3（负向验证后恢复） | A/B/C | **PASS** | 恢复补丁哈希 `2cbc13e… / 7ed8593… / 85074d1…`，B/C 重新全绿 |
| 4（构建验证） | H | **PASS** | `git apply --check` 通过；删除 store 副本后 `bun install` 三个文件均被打上补丁且哈希与 `index` 行一致 |
| 4（构建验证） | I | **PASS** | `✓ built in 13.67s`；`Smoke test passed: 0.0.0-aifix-zytest-issue-46-auto-202610300805`；models 快照与 sandbox worker smoke test 均通过 |
| 4（构建验证） | J | **PASS** | `kilo.map` 中检出 `{ ...getCommonModelConfig("chat"), includeUsage: true }`；产物 295 MiB |
| 5（评审整改后） | B/C/D | **PASS** | B `4 pass`、C `5 pass`、D `23 pass` |
| 5（评审整改后） | F | **PASS** | `packages/opencode` typecheck exit 0；`packages/core` typecheck exit 0；oxlint 命中 6 条且与 HEAD 基线逐条一致（既有行），新文件 0 条；prettier 全绿 |
| 5（评审整改后） | G | **PASS** | `All shared upstream changes are annotated with kilocode_change markers.`；`check-test-ci: ok (25 test-bearing package(s), 22 root script test file(s))` |
| 5（评审整改后） | H | **PASS** | 改写注释后 `git apply --check` 仍通过、哈希不变；`bun install` 仍应用补丁 |
| 5（评审整改后） | K | **PASS（本次改动相关部分）** | `packages/core` 全量 1399 pass / 6 skip / 1 fail（唯一失败为 `project-copy.test.ts` 既有问题）；`packages/core/test/plugin/` 224 pass / 0 fail |
| 5（评审整改后） | I | **PASS** | 二次构建 `✓ built`，`Smoke test passed: 0.0.0-aifix-zytest-issue-46-auto-202610300805` |

### verifier 否决后的二次修复记录

本流程未调用 `verifier` 子代理（该代理标注为"仅由用户手动调用"），因此没有 verifier 否决记录。质量把关由两轮 `reviewer` 承担：

- **第 1 轮**（verdict `pass_with_comment`）：无 blocking。should-fix = 补丁未记录"为什么打补丁而非升级依赖"；nit = marker 注释重复、缺 `index` 哈希行。
- **第 2 轮**（verdict `pass_with_comment`）：三项整改全部核验通过；新提 P1 = 补丁注释中"上游是同一个修复"表述不精确（上游是超集，额外开启 completion usage）；P2 = 新用例应使用 `it.effect` 而非 `it.live`。
- **整改动作**：P1 改写补丁头部注释；P2 把 `it.live` 改为 `it.effect` 并复跑（5 pass / 0 fail）。整改后重新验证 B/C/D/F/G/H/I 全部通过。

### 临时改动清单及恢复状态

| 临时改动 | 位置 | 状态 |
|---|---|---|
| 探针脚本 `probe-together.ts` / `probe-together2.ts` | `packages/opencode/` | 已删除（未进入版本控制） |
| 还原补丁以做负向验证 | `node_modules/.bun/@ai-sdk+togetherai@2.0.41*/dist/index.mjs` | 已恢复为打补丁版本（哈希 `7ed8593…`） |
| `bun install` 造成的 `bun.lock` 镜像源 churn | `bun.lock` | 已 `git checkout -- bun.lock` 还原并手工补回唯一一行（`git diff --numstat bun.lock` = `1 0`） |
| Bun 1.4.4 与 Zig 0.14.1 | `/tmp/opencode/bun144`、`/tmp/opencode/zig-x86_64-linux-0.14.1` | 工作区外，保留供复现构建；不进入仓库 |
| npm tarball 与解包目录 | `/tmp/opencode/*` | 工作区外，不进入仓库 |
| 构建产物 | `packages/opencode/dist/` | 已被 `.gitignore` 覆盖，未进入变更集 |
| `git add` / `commit` / `push` | — | **全程未执行**，所有变更保留在工作区 |

---

## 9. 风险评估

**总体风险等级：low**

| 风险 | 等级 | 说明与缓解 |
|---|---|---|
| 依赖版本漂移导致补丁静默失效 | medium | 补丁钉在 `@ai-sdk/togetherai@2.0.41`。Bun 只对 `patchedDependencies` 里精确的 `name@version` 应用补丁；一旦升级版本而不重新生成补丁，usage 记录会静默回退为 0。**缓解**：仓库已有 `packages/opencode/test/patched-dependencies.test.ts` 守卫，版本不匹配即测试失败；补丁头部注释写明移除条件（上游 2.0.68 起） |
| 补丁改变出站请求体 | low | 新增 `stream_options: {include_usage: true}` 是 OpenAI 兼容接口的标准用法，Together AI 官方支持；仓库自带录制 cassette `packages/llm/test/fixtures/recordings/openai-compatible-chat/togetherai-streams-text.json` 证明该请求返回 200 + usage；Kilo 自己的 native route 早就无条件发送同一字段。若 provider 拒绝该字段会返回 4xx 错误而不是 0 计数——**失败模式是可观测的，不会静默劣化** |
| 影响 completion / embedding / image / rerank 模型 | low | 补丁只改 `createChatModel`，其余模型构造路径一字未动；已逐一核对三个被补丁文件 |
| 非流式路径行为变化 | low | `@ai-sdk/openai-compatible` 只在 `doStream` 里加 `stream_options`；新增用例显式断言 `doGenerate` 的请求体不含该字段且 usage 仍来自响应体 |
| 供应链 / 许可 | low | 补丁是第三方 Apache-2.0 包上的 1 行可审计改动，钉死版本，登记在 `package.json` + `bun.lock`，由既有守卫强制；不改变任何鉴权/TLS 行为 |
| 与 fork-isolation 规则的冲突 | none | 未修改任何 `packages/*/src/` 文件；新增/修改的只有补丁文件、依赖登记、测试与 changeset，因此不需要在共享上游文件里加 `kilocode_change` 标记（测试文件里的标记是注解守卫对 `packages/core/test/**` 的要求） |
| 未覆盖的场景 | low | 无法在本沙箱复现的部分：真实 Together AI 账号的端到端请求、VS Code 扩展完整 UI、历史上已产生的会话不会回填 usage（与上游 PR 声明一致） |

---

## 10. 最终结论

**Issue 46 已修复。** 根因是钉住的 `@ai-sdk/togetherai@2.0.41` 在构造 chat model 时不透传 `includeUsage`，导致流式请求从不携带 `stream_options: {include_usage: true}`，Together AI 因此不回传最后的 usage chunk，AI SDK 把 usage 解析为全 undefined，会话管线再以 `?? new Usage({})` 静默降级为 0，cost 因而是 0。

修复方式：使用仓库既有的 Bun `patchedDependencies` 机制，为 `@ai-sdk/togetherai@2.0.41` 打一个只改 `createChatModel` 的补丁，使 chat model 以 `includeUsage: true` 构造。该补丁同时覆盖 opencode 包的 provider 路径（`packages/opencode/src/provider/provider.ts:154`）与迁移后的 core plugin 路径（`packages/core/src/plugin/provider/togetherai.ts:11`），**不修改任何 provider 源文件**。

验证结论：两层回归测试（SDK 层 4 例 + core plugin 层 1 例，均为 mock fetch、无网络、确定性）在有补丁时全绿、在无补丁时按预期转红；`patched-dependencies` 守卫、两个包的 typecheck、oxlint（与基线逐条一致）、prettier、注解守卫与 CI 调度守卫全绿；CLI 在钉住的 Bun 1.4.4 + Zig 下构建成功并通过三项 smoke test，产物 source map 中确认内联的是打好补丁的 Together AI provider。

评审结论：两轮 `reviewer` 均为 `pass_with_comment`，无 blocking 项，两轮提出的 1 个 should-fix + 4 个 nit/P1/P2 已全部整改并复验通过。

建议：**可以合并**。合并前请确认 CI 的 `bun install` 使用与 `package.json` / `bun.lock` 一致的 registry 源（补丁由 Bun 在安装期应用，不依赖 registry），并在后续升级 `@ai-sdk/togetherai` 时按补丁头部注释的移除条件处理该补丁。

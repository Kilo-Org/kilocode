# LLM_COMPLETION Telemetry Event

## When it fires

After each LLM API response stream completes, once token usage data is received (`src/core/task/Task.ts:3451`).

**Guard condition**: only fires if at least one of `inputTokens`, `outputTokens`, `cacheWriteTokens`, or `cacheReadTokens` is > 0.

## Properties

| Property            | Type     | Required | Description                                   |
| ------------------- | -------- | -------- | --------------------------------------------- |
| `inputTokens`       | `number` | yes      | Total input tokens (after cost normalization) |
| `outputTokens`      | `number` | yes      | Total output tokens                           |
| `cacheWriteTokens`  | `number` | yes      | Cache write tokens (0 if unsupported)         |
| `cacheReadTokens`   | `number` | yes      | Cache read tokens (0 if unsupported)          |
| `cost`              | `number` | no       | Calculated or provider-reported cost in USD   |
| `completionTime`    | `number` | no       | ms from request start to usage received       |
| `inferenceProvider` | `string` | no       | Provider used for inference                   |

Plus standard context properties attached to all events (taskId, modelId, apiProvider, etc.).

## Implementation plan

1. **Define the event name**: `LLM_COMPLETION = "LLM Completion"`

2. **Define the event schema**:

    ```typescript
    {
      inputTokens: number,
      outputTokens: number,
      cacheReadTokens?: number,
      cacheWriteTokens?: number,
      cost?: number,
    }
    ```

3. **Fire after each LLM stream finishes** — specifically after the usage chunk is received (not on the first delta). Record `performance.now()` at request start and compute `completionTime` delta when usage arrives.

4. **Guard**: only fire if at least one token count > 0.

5. **Cost calculation** (optional): multiply input/output/cache token counts by per-token rates for the model. Kilo uses `calculateApiCostAnthropic` / `calculateApiCostOpenAI` based on API protocol.

# Provider Routing Complete Coverage Spec

Version: 1.0.0
Config path: `config/providers.yaml`

---

## 1. Provider Registry Schema

Each provider is registered as a single entry in `config/providers.yaml` under the `providers[]` array.

```yaml
providers:
  - id: string                  # unique, e.g. "claude-primary"
    name: string                # display name, e.g. "Claude (Anthropic)"
    type: cloud | local         # deployment model
    endpoint: string            # base URL, e.g. "https://api.anthropic.com/v1"
    authMethod: api_key | oauth | none
    authRef: string             # secret name in vault/env, e.g. "ANTHROPIC_API_KEY"
    capabilities:               # what this provider can do
      - contract_writing
      - architecture_review
      - code_execution
      - bulk_processing
      - general
    costPerToken:
      input: number             # USD per 1K input tokens, e.g. 0.003
      output: number            # USD per 1K output tokens, e.g. 0.015
    maxContextWindow: integer   # tokens, e.g. 200000
    healthCheckUrl: string      # e.g. "https://api.anthropic.com/v1/health"
    status: healthy | degraded | offline
    lastChecked: ISO-8601       # e.g. "2026-04-17T08:30:00Z"
    rateLimits:
      requestsPerMinute: integer
      tokensPerMinute: integer
    priority: integer           # lower = preferred, used for tie-breaking
    tags: string[]              # freeform, e.g. ["primary", "high-trust"]
```

### Provider Registry Example

```yaml
providers:
  - id: claude-primary
    name: Claude (Anthropic)
    type: cloud
    endpoint: https://api.anthropic.com/v1
    authMethod: api_key
    authRef: ANTHROPIC_API_KEY
    capabilities:
      - contract_writing
      - architecture_review
      - code_audit
      - verdict_generation
    costPerToken:
      input: 0.003
      output: 0.015
    maxContextWindow: 200000
    healthCheckUrl: https://api.anthropic.com/v1/health
    status: healthy
    lastChecked: "2026-04-17T08:30:00Z"
    rateLimits:
      requestsPerMinute: 60
      tokensPerMinute: 100000
    priority: 1
    tags: [primary, high-trust]

  - id: minimax-worker
    name: MiniMax
    type: cloud
    endpoint: https://api.minimaxi.chat/v1
    authMethod: api_key
    authRef: MINIMAX_API_KEY
    capabilities:
      - code_execution
      - bulk_processing
      - general
    costPerToken:
      input: 0.0004
      output: 0.0016
    maxContextWindow: 128000
    healthCheckUrl: https://api.minimaxi.chat/v1/health
    status: healthy
    lastChecked: "2026-04-17T08:30:00Z"
    rateLimits:
      requestsPerMinute: 120
      tokensPerMinute: 500000
    priority: 2
    tags: [worker, high-throughput]

  - id: siliconflow-overflow
    name: SiliconFlow
    type: cloud
    endpoint: https://api.siliconflow.cn/v1
    authMethod: api_key
    authRef: SILICONFLOW_API_KEY
    capabilities:
      - code_execution
      - bulk_processing
      - general
      - overflow
    costPerToken:
      input: 0.0002
      output: 0.0008
    maxContextWindow: 32000
    healthCheckUrl: https://api.siliconflow.cn/v1/health
    status: healthy
    lastChecked: "2026-04-17T08:30:00Z"
    rateLimits:
      requestsPerMinute: 200
      tokensPerMinute: 1000000
    priority: 3
    tags: [fallback, overflow, budget]

  - id: ollama-local
    name: Ollama (Local)
    type: local
    endpoint: http://localhost:11434/api
    authMethod: none
    authRef: ""
    capabilities:
      - private_data
      - local_dev
      - general
    costPerToken:
      input: 0.0
      output: 0.0
    maxContextWindow: 8192
    healthCheckUrl: http://localhost:11434/api/tags
    status: healthy
    lastChecked: "2026-04-17T08:30:00Z"
    rateLimits:
      requestsPerMinute: 0  # unlimited
      tokensPerMinute: 0
    priority: 10
    tags: [local, private, air-gapped]

  - id: lmstudio-local
    name: LM Studio (Local)
    type: local
    endpoint: http://localhost:1234/v1
    authMethod: none
    authRef: ""
    capabilities:
      - private_data
      - local_dev
      - general
    costPerToken:
      input: 0.0
      output: 0.0
    maxContextWindow: 4096
    healthCheckUrl: http://localhost:1234/v1/models
    status: offline
    lastChecked: "2026-04-17T08:30:00Z"
    rateLimits:
      requestsPerMinute: 0
      tokensPerMinute: 0
    priority: 11
    tags: [local, private, experimental]
```

---

## 2. Role Matrix

Maps task types to their primary and fallback providers.

| task_type            | primary_provider    | fallback_provider     | notes                                |
|----------------------|---------------------|-----------------------|--------------------------------------|
| contract_writing     | claude-primary      | siliconflow-overflow  | Requires high-trust, large context   |
| architecture_review  | claude-primary      | siliconflow-overflow  | Needs reasoning depth                |
| code_audit           | claude-primary      | minimax-worker        | Security-sensitive                   |
| verdict_generation   | claude-primary      | none                  | No fallback; queue if unavailable    |
| code_execution       | minimax-worker      | siliconflow-overflow  | High throughput preferred            |
| bulk_processing      | minimax-worker      | siliconflow-overflow  | Cost-sensitive, parallelizable       |
| overflow             | siliconflow-overflow| ollama-local          | Absorbs spike traffic                |
| private_data         | ollama-local        | lmstudio-local        | Must stay local, never cloud         |
| local_dev            | lmstudio-local      | ollama-local          | Developer iteration, no cost         |

### Role Assignment Rules

1. A task type maps to exactly one primary provider.
2. Fallback chains are ordered lists, max depth 3.
3. `private_data` tasks MUST route to `type: local` providers only. Cloud routing is a hard block.
4. `verdict_generation` has no fallback -- if Claude is offline, the task is queued with `ROUTE_NO_PROVIDER` and the operator is notified.

---

## 3. Lane Definitions

### Lane: Claude (claude-primary)

```yaml
lane: claude
endpoint_pattern: https://api.anthropic.com/v1/messages
auth:
  method: api_key
  header: x-api-key
  env: ANTHROPIC_API_KEY
rate_limits:
  requests_per_minute: 60
  tokens_per_minute: 100000
  concurrent_requests: 10
cost_model:
  input_per_1k: 0.003
  output_per_1k: 0.015
  currency: USD
supported_task_types:
  - contract_writing
  - architecture_review
  - code_audit
  - verdict_generation
context_window: 200000
models:
  - claude-sonnet-4-20250514
  - claude-opus-4-20250514
```

### Lane: MiniMax (minimax-worker)

```yaml
lane: minimax
endpoint_pattern: https://api.minimaxi.chat/v1/text/chatcompletion_v2
auth:
  method: api_key
  header: Authorization
  prefix: "Bearer "
  env: MINIMAX_API_KEY
rate_limits:
  requests_per_minute: 120
  tokens_per_minute: 500000
  concurrent_requests: 50
cost_model:
  input_per_1k: 0.0004
  output_per_1k: 0.0016
  currency: USD
supported_task_types:
  - code_execution
  - bulk_processing
  - general
context_window: 128000
models:
  - MiniMax-Text-01
```

### Lane: SiliconFlow (siliconflow-overflow)

```yaml
lane: siliconflow
endpoint_pattern: https://api.siliconflow.cn/v1/chat/completions
auth:
  method: api_key
  header: Authorization
  prefix: "Bearer "
  env: SILICONFLOW_API_KEY
rate_limits:
  requests_per_minute: 200
  tokens_per_minute: 1000000
  concurrent_requests: 100
cost_model:
  input_per_1k: 0.0002
  output_per_1k: 0.0008
  currency: USD
supported_task_types:
  - code_execution
  - bulk_processing
  - general
  - overflow
context_window: 32000
models:
  - deepseek-ai/DeepSeek-V3
  - Qwen/Qwen2.5-72B-Instruct
```

### Lane: Ollama (ollama-local)

```yaml
lane: ollama
endpoint_pattern: http://localhost:11434/api/chat
auth:
  method: none
rate_limits:
  requests_per_minute: 0   # no limit
  tokens_per_minute: 0
  concurrent_requests: 1   # single GPU constraint
cost_model:
  input_per_1k: 0.0
  output_per_1k: 0.0
  currency: USD
supported_task_types:
  - private_data
  - local_dev
  - general
context_window: 8192       # model-dependent
models:
  - llama3.1:8b
  - codellama:13b
  - mistral:7b
```

### Lane: LM Studio (lmstudio-local)

```yaml
lane: lmstudio
endpoint_pattern: http://localhost:1234/v1/chat/completions
auth:
  method: none
rate_limits:
  requests_per_minute: 0
  tokens_per_minute: 0
  concurrent_requests: 1
cost_model:
  input_per_1k: 0.0
  output_per_1k: 0.0
  currency: USD
supported_task_types:
  - private_data
  - local_dev
  - general
context_window: 4096
models:
  - user-loaded           # depends on what the user loads in LM Studio
```

---

## 4. Routing Decision Engine

### Input

```typescript
interface RoutingRequest {
  task_type: string;           // e.g. "contract_writing"
  data_sensitivity: "public" | "internal" | "confidential" | "restricted";
  cost_budget: {
    max_cost_usd: number;      // per-request ceiling
    session_remaining_usd: number;
  };
  context_tokens: number;      // estimated input tokens
  availability: Record<string, "healthy" | "degraded" | "offline">;
}
```

### Output

```typescript
interface RoutingDecision {
  provider_id: string;          // selected provider
  model: string;                // specific model within the provider
  reasoning: string;            // human-readable explanation
  fallback_chain: string[];     // ordered list of fallback provider IDs
  estimated_cost_usd: number;
  warnings: string[];           // e.g. ["degraded provider selected", "near budget limit"]
}
```

### Decision Algorithm

```
1. FILTER by data_sensitivity:
   - if "restricted" or "confidential" → only type:local providers
   - if "internal" → exclude providers without tag "high-trust"
   - if "public" → all providers eligible

2. FILTER by task_type:
   - keep only providers whose capabilities[] includes the task_type
   - if none remain → return error ROUTE_NO_PROVIDER

3. FILTER by context_tokens:
   - keep only providers where maxContextWindow >= context_tokens
   - if none remain → return error ROUTE_CONTEXT_EXCEEDED

4. FILTER by availability:
   - exclude providers with status "offline"
   - flag providers with status "degraded"

5. FILTER by cost_budget:
   - estimate cost = (context_tokens / 1000 * costPerToken.input) + (estimated_output / 1000 * costPerToken.output)
   - exclude providers where estimate > cost_budget.max_cost_usd
   - exclude providers where estimate > cost_budget.session_remaining_usd
   - if none remain → return error ROUTE_BUDGET_EXCEEDED

6. RANK remaining providers by:
   - priority (ascending)
   - prefer healthy over degraded
   - prefer lower cost if priorities tie

7. SELECT top-ranked provider
8. BUILD fallback_chain from remaining ranked providers (max depth 3)
```

---

## 5. Health Check Protocol

```yaml
health_check:
  ping_interval_seconds: 30
  failure_threshold: 3          # consecutive failures → mark offline
  degraded_threshold: 2         # consecutive slow responses → mark degraded
  degraded_latency_ms: 5000     # response time above this = slow
  recovery_check_interval_seconds: 60  # how often to re-check offline providers
  recovery_threshold: 2         # consecutive successes → mark healthy

  circuit_breaker:
    enabled: true
    open_after_failures: 5      # stop sending requests after N failures
    half_open_after_seconds: 120 # try one request after cooldown
    close_after_successes: 3    # consecutive successes in half-open → close circuit

  timeout:
    health_check_ms: 3000       # max wait for health endpoint
    request_ms: 30000           # max wait for an actual API request
```

### Health Check State Machine

```
HEALTHY ──(degraded_threshold slow responses)──→ DEGRADED
DEGRADED ──(failure_threshold failures)──→ OFFLINE
DEGRADED ──(recovery_threshold fast responses)──→ HEALTHY
OFFLINE ──(recovery_check succeeds recovery_threshold times)──→ HEALTHY
OFFLINE ──(circuit_breaker.open_after_failures)──→ CIRCUIT_OPEN
CIRCUIT_OPEN ──(half_open_after_seconds elapsed)──→ HALF_OPEN
HALF_OPEN ──(close_after_successes)──→ HEALTHY
HALF_OPEN ──(any failure)──→ CIRCUIT_OPEN
```

### Health Check Response

```typescript
interface HealthCheckResult {
  provider_id: string;
  timestamp: string;       // ISO-8601
  status: "healthy" | "degraded" | "offline";
  latency_ms: number;
  error: string | null;
  consecutive_failures: number;
  circuit_state: "closed" | "open" | "half_open";
}
```

---

## 6. Route Trace Schema

Every routing decision produces a trace record persisted to the trace log.

```typescript
interface RouteTrace {
  trace_id: string;            // UUID v4
  timestamp: string;           // ISO-8601
  task_id: string;             // the task that triggered routing
  task_type: string;           // e.g. "contract_writing"
  data_sensitivity: string;    // from the routing request
  requested_provider: string | null;  // if the caller had a preference
  actual_provider: string;     // provider_id that handled the request
  model_used: string;          // specific model, e.g. "claude-sonnet-4-20250514"
  routing_reason: string;      // human-readable, e.g. "primary for contract_writing"
  fallback_used: boolean;
  fallback_chain: string[];    // full chain considered
  fallback_depth: number;      // 0 = primary, 1 = first fallback, etc.
  latency_ms: number;          // total request duration
  tokens_used: {
    input: number;
    output: number;
  };
  cost_usd: number;            // actual cost for this request
  error_code: string | null;   // null if success
  session_id: string;          // links to the broader session
}
```

### Trace Storage

- Traces are written to `data/traces/routes/YYYY-MM-DD.jsonl` (one JSON object per line).
- Retained for 90 days, then archived to cold storage.
- Queryable via the Trace Panel in the UI.

---

## 7. Error Codes

| Code                    | HTTP Equiv | Description                                              | Recovery                                         |
|-------------------------|------------|----------------------------------------------------------|--------------------------------------------------|
| ROUTE_NO_PROVIDER       | 503        | No provider registered for the requested task type       | Register a provider with matching capability     |
| ROUTE_ALL_OFFLINE       | 503        | All providers in the fallback chain are offline           | Wait for health recovery or add providers        |
| ROUTE_WRONG_ROLE        | 400        | Task type sent to a provider that lacks the capability   | Router blocks this; check role matrix config     |
| ROUTE_BUDGET_EXCEEDED   | 402        | Estimated cost exceeds per-request or session budget     | Increase budget or use a cheaper provider        |
| ROUTE_AUTH_FAILED       | 401        | Provider rejected the auth credentials                   | Check authRef env var / rotate key               |
| ROUTE_RATE_LIMITED      | 429        | Provider rate limit hit                                  | Back off, retry after delay, or use fallback     |
| ROUTE_CONTEXT_EXCEEDED  | 413        | Input tokens exceed provider's maxContextWindow          | Truncate input or route to larger-context provider|
| ROUTE_TIMEOUT           | 504        | Provider did not respond within request timeout          | Retry or failover to next in chain               |
| ROUTE_CIRCUIT_OPEN      | 503        | Circuit breaker is open for this provider                | Wait for half-open window                        |

### Error Response Envelope

```typescript
interface RouteError {
  error_code: string;        // from table above
  message: string;           // human-readable
  provider_id: string;       // which provider failed
  task_id: string;
  timestamp: string;
  retry_after_ms: number | null;  // hint for RATE_LIMITED and CIRCUIT_OPEN
  fallback_attempted: boolean;
  trace_id: string;          // links to the route trace
}
```

---

## 8. Config Path

Primary configuration: `config/providers.yaml`

```
config/
  providers.yaml          # provider registry + lane definitions
  providers.local.yaml    # local overrides (gitignored)
  routing-rules.yaml      # role matrix + decision engine weights
  health-check.yaml       # health check intervals and thresholds
```

Environment variables referenced:
- `ANTHROPIC_API_KEY`
- `MINIMAX_API_KEY`
- `SILICONFLOW_API_KEY`

---

## Acceptance Criteria

1. A `contract_writing` task routes to `claude-primary`.
2. A `code_execution` task routes to `minimax-worker`.
3. A `private_data` task routes only to `type: local` providers; cloud routing is blocked.
4. When `claude-primary` is offline, a `contract_writing` task falls back to `siliconflow-overflow` and the fallback event appears in the route trace.
5. A task sent to a provider lacking the capability returns `ROUTE_WRONG_ROLE` and is rerouted.
6. A request exceeding `cost_budget.max_cost_usd` returns `ROUTE_BUDGET_EXCEEDED` before any provider call.
7. Health check transitions (healthy -> degraded -> offline -> healthy) are logged and visible in the health status panel.
8. Route traces are queryable by `task_id`, `provider_id`, `session_id`, and date range.
9. Circuit breaker opens after configured failures and enters half-open after cooldown.

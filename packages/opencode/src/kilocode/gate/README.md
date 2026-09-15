# ActionGate (experimental, opt-in)

The ActionGate blocks dangerous tool actions before they run, independent of *why* the agent chose them
(careless overreach or prompt injection). It is **off by default** — every flag below is inert unless the
environment variable is set to `1`, and prior behavior is unchanged when they are unset.

## Flags and defaults

| Env flag | Default | What it enables |
|---|---|---|
| `KILO_ACTION_GATE` | off | Stage 1 — the deterministic `rm -rf` **tripwire** (below). No model call. |
| `KILO_ACTION_CLASSIFIER` | off | Stage 2 — the reasoning-blind **classifier** for shell commands. Requires a provider. |
| `KILO_WRITE_GATE` | off | Extends the classifier to `edit` / `write` / `apply_patch` (judged by path + op, never content). |
| `KILO_MCP_GATE` | off | Extends the classifier to MCP tool calls (judged by server + tool + argument **keys**, never values). |
| `KILO_ACTION_GATE_AUTHORIZER` | off | Opt-in: a confirmed classifier `allow` may one-shot pre-approve *only* the verified action, suppressing its otherwise-redundant permission prompt. Root session only. |
| `KILO_CLASSIFIER_TELEMETRY` | unset | Path to a JSONL file; when set, one **redacted** record (latency + token counts + verdict) is appended per classifier call. Never records intent, command, or args. |

Set these variables before launching Kilo; there is no supported session-toggle. The classifier and each gate
are independent (e.g. the tripwire can run without the classifier).

## Stage 1 — deterministic rm tripwire

Blocks a destructive `rm -rf` (recursive **and** force) whose target is a critical path: the filesystem
root, your home directory, a top-level directory, or the workspace/cwd itself or any parent of it. A scoped
delete inside the project (e.g. `rm -rf build`) is allowed. Command tokens come from the shell tree-sitter
parser, never a regex over the raw string. A tripwire block is a tool error (deny-and-continue), not a
session halt. It **fails closed**:

- A target that cannot be resolved (dynamic `$HOME` / `$PWD` / globs) is blocked.
- A **relative** target in a command chain that also changes the working directory (`cd` / `pushd` / `popd`)
  is blocked, because the effective cwd cannot be proven statically — this closes
  `cd .. && rm -rf <workspace-basename>`. Absolute targets are cwd-independent and still resolve.
- Simple wrappers are unwrapped with no fixed depth (`sudo` / `command` / `env FOO=bar …`, nested).

## Stage 2 — reasoning-blind classifier

Compares the action against the **original user intent only**, blind to untrusted context (tool output,
rules files, assistant reasoning) so an injected instruction cannot argue its way past it. Verdict is a
strict schema: the model may only `allow` (matches_intent) or `block` (a fixed reason code). A block is a
tool error (deny-and-continue). Read-only fast-path commands and deterministic tripwires never call the model.

## Degradation policy (fail-safe)

If the classifier itself fails — timeout, provider error, malformed output, or provider unavailable — the
gate does **not** hard-block. It fails **safe** by escalating to a one-shot manual approval (`ask`). This is
a degradation, not a model verdict, and is never counted as a classification.

- **Interactive clients** (TUI / IDE) show the request to a human, with a "safety classifier unavailable" note.
- **Headless `kilo run --auto`**: a degraded ask is answered `reject` (deny-and-continue); an ordinary
  (non-degraded) ask is answered `once`. A bare `kilo serve` with no auto-responder may leave the request
  pending.

## One-shot pre-approval (`KILO_ACTION_GATE_AUTHORIZER=1`)

When on, a confirmed classifier `allow` pre-approves *only* the exact action-level request it verified,
suppressing that request's redundant prompt. It never weakens `deny`, hard rules, Config Protection,
skill-shell, sandbox escalation, or the degraded fail-safe; `external_directory` stays a normal prompt; it
persists no rule; and child/subagent sessions are never pre-approved. The permission layer additionally
requires the flag, so a stray marker cannot pre-approve while the feature is off.

## Latency and cost

- The tripwire, the read-only fast path, an internal block, and any disabled flag make **no** model call.
- A gated action that reaches the semantic classifier costs **at most one** small model call. It is a
  marginal cost on top of the agent's own model usage; the exact price depends on your provider/model.
- With `KILO_CLASSIFIER_TELEMETRY` set, each classifier call's latency and token counts are recorded
  (redacted). Telemetry write failures are logged and never affect the verdict.

## Known limitations

- The write and MCP gates judge **targets/identity only** (path+op, or server+tool+arg keys) and never see
  file content or argument values, so a dangerous *value* inside an otherwise on-intent write is not caught
  by identity alone.
- Complex wrappers that carry their own options (`sudo -u x`, `env -i`, `command -v`) are intentionally not
  peeled — a documented limitation, not silently mis-handled.
- The classifier is a model and its judgment is not perfect on borderline cases; the deterministic tripwire
  is the only architecturally injection-proof control.
- Child/subagent sessions fail closed for the write/MCP gates (intent is agent-authored, not human-verified).

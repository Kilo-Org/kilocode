# ActionGate (experimental)

The ActionGate is an experimental, opt-in safety layer that blocks dangerous tool actions before they run —
independent of *why* the agent chose them (a careless mistake or a prompt injection). It is **off by
default**: every flag below is inert unless you set the environment variable to `1`, and Kilo behaves exactly
as before when they are unset.

## Enabling it

Set the environment variables for the stages you want, then start Kilo. For example, to enable the full gate:

```bash
export KILO_ACTION_GATE=1        # deterministic rm -rf tripwire
export KILO_ACTION_CLASSIFIER=1  # reasoning-blind classifier for shell commands
export KILO_WRITE_GATE=1         # extend the classifier to file writes
export KILO_MCP_GATE=1           # extend the classifier to MCP tool calls
kilo
```

Set these variables before launching Kilo; there is no supported session-toggle. Each flag is independent —
for example the deterministic tripwire (`KILO_ACTION_GATE`) works on its own, without the classifier.

## Flags

| Variable | Default | Effect |
|---|---|---|
| `KILO_ACTION_GATE` | off | Deterministic `rm -rf` **tripwire**: blocks a recursive+force delete of a critical path (filesystem root, home, a top-level directory, or the workspace/cwd or any parent of it). Scoped deletes inside the project (e.g. `rm -rf build`) are allowed. No model call. |
| `KILO_ACTION_CLASSIFIER` | off | Reasoning-blind **classifier** for shell commands: compares the command against your original request only (blind to untrusted context), and blocks clearly off-intent actions. Requires a configured provider. |
| `KILO_WRITE_GATE` | off | Extends the classifier to `edit` / `write` / `apply_patch`, judged by path + operation only (never file content). |
| `KILO_MCP_GATE` | off | Extends the classifier to MCP tool calls, judged by server + tool + argument **keys** only (never values). |
| `KILO_ACTION_GATE_AUTHORIZER` | off | When a classifier `allow` verdict confirms an action, pre-approve *only* that action once, suppressing its otherwise-redundant permission prompt. Root sessions only. |
| `KILO_CLASSIFIER_TELEMETRY` | unset | Path to a JSONL file. When set, one redacted record (latency, token counts, verdict) is appended per classifier call — never your intent, command, or arguments. |

## What happens when the classifier can't decide

If the classifier itself fails — a timeout, a provider error, malformed output, or the provider being
unavailable — the gate does **not** hard-block. It fails safe by asking you to approve the action once:

- In the interactive TUI/IDE you get a one-shot prompt with a "safety classifier unavailable" note.
- In headless `kilo run --auto`, a degraded ask is auto-**rejected** (the tool call fails and the session
  continues); an ordinary ask is auto-approved as usual.

The one-shot prompt preserves the normal action details and offers only **Allow once** or **Reject**:

![ActionGate fail-safe approval after a classifier timeout](/docs/img/action-gate/fail-safe-approval.png)

## Cost and latency

The tripwire, the read-only fast path, and any disabled flag make **no** model call. An action that reaches
the classifier costs at most one small model call on top of the agent's own usage; the exact price depends on
your provider and model.

## Known limitations

- The write and MCP gates judge the **target/identity** (paths, operations, tool names, argument keys), not
  file content or argument values, so a dangerous *value* inside an otherwise on-intent action is not caught
  by identity alone.
- Command wrappers that carry their own options (`sudo -u`, `env -i`, `command -v`) are intentionally not
  unwrapped.
- The classifier is a model; its judgment is not perfect on borderline cases. Only the deterministic tripwire
  is fully immune to prompt injection.
- Sub-agent/child sessions fail closed for the write and MCP gates, because the intent there is
  agent-authored rather than human-verified.

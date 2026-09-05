# Kilo agent policy v2 parity

Source comparison: local Kilo v1 `origin/main` at
`ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7`, and current v2
`59b29de40966803e2c7cd734d439843fb773f6a6` plus local host extensions.
This is not a validation of the older `76dbaf2` pinned snapshot.

`packages/kilo-cli/src/agent-policy.ts` is a host policy plugin. Register it with
`{ phase: agentPolicyPhase }` after native config discovery so a user-defined
agent ID wins over a Kilo compatibility default.

| V1 behavior | V2 result | Decision |
|---|---|---|
| Build mode presented as Code | Native `build` keeps its ID and is named Code | Ported without changing the core default-agent ID. |
| Build label leaked through transcript IDs | Native display-name lookup now covers assistant footer, agent-switch notices and subagent presentation as well as picker/composer | Real TUI conversation checks Code labels while public history retains `agent: build`; absent metadata keeps the native fallback. |
| Build presentation collision | The public v2 agent editor has no source/provenance field | Rename only when the current name is native `Build`; a preconfigured presentation is left unchanged. |
| Ask mode is read-only | Missing `ask` is a primary agent with explicit deny rules for shell, edits, delegation, and all other tools | Ported through v2 permission rules; no shell command allowlist is added. |
| Debug mode | Missing `debug` is a primary evidence-led diagnostic agent | Ported through the public agent transform. |
| Explore and system/delegated agents | Existing v2 agents are not removed or rewritten | Preserved. |
| Orchestrator | Deprecated v1 agent | Intentionally not resurrected. |
| Custom agent collision | Existing `ask` or `debug` ID is left unchanged | User config takes precedence. |
| Plan prompt files and `plan_exit` lifecycle | V2 has a native Plan agent, scoped plan-directory permissions, and reminder lifecycle, but no matching public legacy file/exit seam | Not ported. The policy deliberately does not rewrite Plan, avoiding overrides of user Plan config. |

The focused test starts an isolated loopback host with the bundled Bun 1.4.0 runtime,
uses production `launch()` registration, and inspects agents through the public
client. It checks native permission evaluation and drives denied Ask shell and
Debug read requests with a loopback fake model. No live credentials or paid
inference are used. Existing custom Ask/Debug and Plan definitions remain intact.

The rename is presentation, not an ID migration. This slice does not add a
`code` alias for CLI/API/config inputs or rewrite existing sessions. Those v1
compatibility inputs need separate validation under the open built-in-agent
inventory row. No default/core execution or permission behavior changes here.

Rename follow-up validation (bundled Bun 1.4.0): `test/tui.test.tsx`,
`test/agent-policy.test.ts` and `test/model-picker-ui.test.tsx` — **4 pass,
0 fail, 42 assertions**. CLI and TUI typechecks pass; native model-presentation
regressions **6 pass / 0 fail**. The real TUI fixture requires both composer
and assistant footer labels, rejects any visible Build label, checks switches
in both directions, and verifies the stored assistant agent remains `build`.

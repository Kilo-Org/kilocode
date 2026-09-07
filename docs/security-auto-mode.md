# Security Auto Mode

Deterministic `ALLOW / ASK / DENY` adjudication for side-effecting tool calls, sitting between Kilo's
permission prompts and unsafe auto-approval. Off by default.

> Agent intent may be compromised; agent authority stays bounded by deterministic policy plus the
> existing sandbox. No *guarantee* depends on a model recognising an attack.

One layer does use a model — [semantic evidence](#semantic-evidence-security_auto_classifier) — and it
is wired so that this stays true: it returns evidence into the same monotone reducer as every other
layer, so it can only make a decision stricter, it is never asked about a decision the deterministic
layers already settled, and with no model configured it contributes nothing, which is the same product
as running without that code at all.

## Threat model

The developer running Kilo is trusted, and so is what they ask for. The danger is what happens
*between* the request and the result:

- **The agent damages the environment.** A destructive command aimed at the wrong directory, a
  credential store read on the way to something else, a change to Kilo's own policy files.
- **Untrusted content steers the agent.** A README, an issue body, a web page or an MCP tool
  description that carries instructions; a package name that is one character from a real one.
- **Untrusted content *is* code.** A cloned repository ships a `.kilocode/tool/*.ts` file or declares a
  plugin. Both execute their module scope the moment Kilo discovers them — before any tool call exists
  to adjudicate.
- **Data leaves.** A secret read in one step and sent in another, through a shell command, an MCP
  upload, or an extension's own network access.

Out of scope: an attacker who already controls the user's machine or Kilo's own installation, a
malicious *user*, and defending the model's reasoning. Every guarantee below is a property of code and
policy, not of the model noticing anything.

## Trust boundaries

| Boundary | Who is on the inside | What crossing it requires |
|---|---|---|
| **Configuration** | the user's global config | project configuration can never enable the mode, change a layer, grant a capability or approve code |
| **Tool call** | Kilo's own built-in tools | every side-effecting call passes `SecurityGate` before its effect; unknown authority is asked, never assumed |
| **Delegated authority** | tools the user vouched for | an MCP or workspace tool cannot raise its own trust through its id, description or annotations |
| **Executable project code** | code approved by content digest, above project level | a repository-controlled module is discovered but not imported until a human approved those exact bytes |
| **Extension runtime** | an approved extension's own process | privileged effects are IPC requests the engine adjudicates; the OS profile confines writes, network, process spawning and reads |
| **Session state** | one session's secret context | secrets observed in a session shape only that session's later decisions; nothing is persisted |

## Enabling

- Global config (`~/.config/kilo/kilo.json` or `opencode.json`): `{ "experimental": { "security_auto": true } }`
- or the environment variable `KILO_SECURITY_AUTO=1` (`0` / `false` forces it off).

Seven additional evaluation layers are on whenever the mode is on and can be switched off
individually, global config or environment only:

| Layer | Config key | Env | Default |
|---|---|---|---|
| Package provenance preflight | `experimental.security_auto_packages` | `KILO_SECURITY_AUTO_PACKAGES` | on |
| Stateful secret-egress protection | `experimental.security_auto_egress` | `KILO_SECURITY_AUTO_EGRESS` | on |
| Delegated-authority classification | `experimental.security_auto_tools` | `KILO_SECURITY_AUTO_TOOLS` | on |
| Workspace secret-content classification | `experimental.security_auto_content` | `KILO_SECURITY_AUTO_CONTENT` | on |
| Executable project-code trust boundary | `experimental.security_auto_code` | `KILO_SECURITY_AUTO_CODE` | on |
| Permissioned extension runtime | `experimental.security_auto_extension_runtime` | `KILO_SECURITY_AUTO_EXTENSION_RUNTIME` | on |
| Semantic evidence (needs a model) | `experimental.security_auto_classifier` | `KILO_SECURITY_AUTO_CLASSIFIER` | on, inert with no model |

Two more global-config keys govern what an approved extension may do:

| Key | Meaning |
|---|---|
| `experimental.security_auto_extension_grants` | capabilities per approved digest, e.g. `{"<sha256>": ["network"]}`; without an entry an extension is read-only |
| `experimental.security_auto_extension_unconfined_reads` | accept extension hosts with ambient read access to your files — it turns read confinement off where the platform supports it, and lets an approved extension run where it does not. Off by default, and by default such a platform refuses to run the extension instead. |

The delegated-authority layer also reads the capabilities you vouch for, per tool id or glob:

```jsonc
{ "experimental": { "security_auto_tool_capabilities": {
    "docs_*": ["readonly"],            // a read-only MCP server you trust
    "deploy_upload": ["network"]       // an outbound tool you rely on
} } }
```

Recognised names: `readonly`, `filesystem-read`, `filesystem-write`, `process`, `network`, `package`,
`delegated-authority`, `security-control`. Unrecognised names are dropped rather than trusted.

Project configuration is ignored on purpose: a repository must not be able to switch the mode, its
layers, or the capabilities of the tools it also ships. The global config directory itself is protected
by the engine's hard rules, so the agent cannot switch it either. The existing `--auto` /
allow-everything semantics are untouched when the flag is off.

## Execution flow (as implemented in Kilo today)

```
model tool call
  └─ SessionTools.resolve                     packages/opencode/src/session/tools.ts
       ├─ plugin.trigger("tool.execute.before")
       ├─ SandboxPolicy.executeTool          (unrestricted() when the sandbox is off)
       │    └─ SecurityGate.execute           envelope ask for unclassified tools, blocked-result conversion
       │         └─ item.execute(args, ctx)   the tool
       │              └─ ctx.ask(request)     every side-effecting builtin asks before its effect
       │                   └─ KiloSessionPrompt.askPermission   packages/opencode/src/kilocode/session/prompt.ts
       │                        ├─ buildAskRuleset (agent + session rules, provenance tags)
       │                        ├─ SecurityGate.evaluate  → normalise → SecurityEngine → decision
       │                        ├─ DENY  → fail SecurityDeniedError (Permission.ask never runs)
       │                        ├─ ASK   → hard: metadata.securityAsk forces an interactive prompt
       │                        ├─ ALLOW → lifts only the built-in / unmatched ask via a `source: "security"` rule
       │                        └─ Permission.ask   packages/opencode/src/permission/index.ts (existing deny / veto / prompt logic)
       ├─ plugin.trigger("tool.execute.after")
       └─ SessionProcessor → tool part → next model context

MCP tool call
  └─ SessionTools.resolve (MCP loop)          packages/opencode/src/session/tools.ts
       └─ SandboxPolicy.executeMcp
            └─ SecurityGate.delegate           settles session state, denial → structured result
                 └─ ctx.ask(<server>_<tool>)   carries the MCP identity + capabilities
                      └─ KiloSessionPrompt.askPermission → SecurityGate → Permission.ask
                 └─ client.callTool(...)       the remote call, only if the ask succeeded

MCP resource tools (list_mcp_resources, list_mcp_resource_templates, read_mcp_resource)
  └─ SessionTools.resolve                     packages/opencode/src/session/tools.ts
       └─ SecurityGate.delegate                the same lifecycle as a delegated MCP call
            ├─ ctx.ask(read)                   the tool's own ask — no second permission request
            ├─ mcp.resources / readResource    the server's own words
            └─ settle                          recorded as untrusted context; a denial becomes a
                                               structured result, not a defect
```

The three MCP resource tools are Kilo built-ins, but the text they hand the agent is written outside
Kilo, so they run through the delegated lifecycle rather than the built-in envelope: the envelope's
ingest attribution reads the *tool's* provenance, which for a built-in is `builtin`, and the resource
text would never be recorded. What they gain is the settle step — where the classifier layer is on,
the words a resource returned become part of the untrusted context the *next* side-effecting action
is judged against — and the conversion of a denial into a readable result. The provenance label
follows the origin of the content (`mcp-untrusted` / `remote-untrusted`), not the tool that fetched
it. The ask itself, its patterns and its metadata are unchanged.

The shell tool additionally parses the command with Tree-sitter (`ShellPermission.check`) and asks
`external_directory` / `bash` / `sandbox_escalation`. The security normaliser reuses that parser and
its helpers (`ShellAst`, exported from `tool/shell.ts`) rather than adding a second one.

### Choke point

`ctx.ask` → `KiloSessionPrompt.askPermission` is the single Kilo-owned point that every builtin tool
passes through before its side effect, and it already assembles the ruleset and provenance. The
engine is invoked there. `SessionTools.resolve` adds coverage: tools that are not known to ask
(custom, plugin, `notify_user`, ...) receive an envelope ask so the engine at least sees them, and a
security denial anywhere inside a tool is converted into a structured, non-fatal tool result.

## Decision model

- `SecurityEngine.evaluate(action, context)` is pure and synchronous; the normalisers run before it.
- Evidence is reduced monotonically: `DENY > ASK > ALLOW`; a weaker piece of evidence never relaxes a
  stronger one. Compound shell commands are evaluated as a whole, nested payloads included.
- `hard` decisions (all DENY; ASK from an immutable rule) override every permissive permission rule,
  including saved "always allow" approvals and allow-everything. A soft ASK only means "the engine
  cannot vouch for this": the existing permission rules decide.
- ALLOW never overrides anything: it only replaces the built-in default ask (`source: agent` or the
  unmatched fallback). Explicit user / project / session `ask` rules and every `deny` rule stay in force.
- Any failure inside the security layer is a hard ASK (`SECURITY_ENGINE_ERROR`), never ALLOW.
- A hard ASK request cannot be resolved by allow-everything, by sibling-approval draining, or by a
  non-interactive reply; a human must answer it.

## What the normaliser sees

`ShellNormalizer` (`packages/opencode/src/kilocode/security/shell.ts`):

- every `command` node inside lists, pipelines, subshells, substitutions, loops and functions, with
  every operand (the permission scanner's `parts()` drops `$VAR`, `$(...)` and numeric words; the
  security tokenizer keeps them so a destructive command never looks operand-free);
- shell quoting removed the way the shell does it (`r''m`, `'r'm`, `r\m` are `rm`), static brace
  expansion (`{build,/etc}` classifies every target and keeps the riskiest), `~user` / `~+` /
  `%VAR%` / `@splat` treated as unknown;
- executable + argv after unwrapping `sudo`/`doas`/`su`, `env` (including `env -S` re-splitting),
  `busybox`, `nohup`, `nice`, `timeout`, `xargs`, ...;
- static cwd tracking across `cd`/`pushd`/`popd` per scope (a subshell `cd` stays in the subshell, a
  dynamic `cd` makes later relative targets unknown);
- path operands classified per effect (read / write / delete / chmod / exec), redirect targets, `ln -s`
  links created earlier in the same command line;
- pipelines and their producers (`base64 -d | sh`, `curl | sh`), process substitution, PowerShell
  pipeline binding (`Get-Item ~/.ssh | Remove-Item` has unknown targets);
- recursive analysis of `bash|sh|zsh|... -c`, `pwsh|powershell -Command`, `cmd /c` payloads up to depth 4;
  dynamic payloads stay opaque;
- interpreter indirection (`python -c`, `node -e`, ...), exec-escape options (`rg --pre`, `man -P`,
  `tar --checkpoint-action=exec`, `find -exec`, `sed w`, `awk system()`, `LD_PRELOAD=`), git
  subcommand semantics including read-only subcommands that read file operands (`git show ~/.ssh/id_rsa`),
  package manager operations, devices, system control, scheduled tasks and services, container escapes,
  output options that write files (`sort -o`, `curl -o`, `dd of=`, `patch -d`, `tar -C`);
- parse errors (`UNKNOWN_SHELL_SYNTAX`).

`PathRisk` (`path.ts`) classifies after expansion, resolution against the effective cwd and
canonicalisation through the nearest existing ancestor (both lexical and physical location are
classified, the riskier wins): `workspace`, `workspace-root`, `workspace-config`, `temp`, `home`,
`home-root`, `home-sensitive` (credential stores, private keys, shell startup files, git identity),
`kilo-security` (global config, `~/.kilo`, sandbox state, runtime state), `system`, `root`,
`external`, `unknown`; plus labels such as `private-key`, `credential`, `secret`, `device`, `git-dir`,
`workspace-ancestor`.

## Hard rules (immutable)

| Rule | Decision |
|---|---|
| recursive / plain destruction of `/`, system roots, home root, ancestors of the workspace | DENY |
| writes, deletes, chmod on credential stores, private keys, shell startup files, Kilo config / state | DENY |
| reads of private keys and credential files (`~/.ssh/id_*`, `~/.aws/credentials`, `~/.netrc`, ...) | DENY |
| `sudo`, `doas`, `su`, `pkexec` | DENY |
| block devices, `mkfs*`, `dd of=/dev/*`, `diskutil erase*`, `> /dev/sd*` | DENY |
| `shutdown`, `reboot`, `crontab -r`, `kill -9 -1`, persistence commands (`crontab`, `launchctl load`, `at`) | DENY |
| decoded payload into a shell / interpreter, `pwsh -EncodedCommand` | DENY |
| network content piped or substituted into a shell / interpreter | DENY |
| calls to the local Kilo server permission / sandbox routes (any loopback spelling, unix sockets) | DENY |
| unparsed shell text, opaque `bash -c` payloads, `eval`, piped shells, exec-escape options, dynamic executables | hard ASK |
| destructive commands with dynamic or stdin targets, dynamic redirect targets | hard ASK |
| credential metadata reads (`~/.ssh/config`), `.env` / key-like files in the workspace | hard ASK |
| project configuration at any depth, case-insensitive (`kilo.json`, `opencode.json(c)`, `.kilo/**`, `.kilocode/**`, `.claude/**`, `AGENTS.md`, `CLAUDE.md`), `.git` directory, whole-workspace deletes | hard ASK |
| commands that act on their working directory while it is outside the workspace (`npm install`, `make`, `tar x`) | soft ASK, hard ASK inside sensitive directories |
| destructive git (`push --force`, `reset --hard`, `checkout -- .`, `clean -f`, `branch -D`, global config) | hard ASK |
| system package managers, publishing, system services, privileged containers | hard ASK |

Default policy: ordinary reads, workspace writes and deletes, temp-dir actions, git read-only and
non-destructive mutations, project scripts (`npm test`, `make`, `python script.py`) are ALLOW.
Package installs, fetch-and-execute (`npx`), outbound network tools, interpreter inline code, writes
outside the workspace, unrecognised git subcommands and unclassified tools are soft ASK.

## Evidence layers

The evidence layers run after the deterministic rules and hand structured evidence to the same
monotonic reducer, so they can only *tighten* a decision — a deterministic DENY / hard ASK is never
weakened, and their own failures fail safe (a hard ASK, never ALLOW). Each is independently
switchable (see
[Enabling](#enabling)).

### Package provenance preflight (`security_auto_packages`)

A recognised package operation is evaluated against registry metadata *before* the package manager
runs, so an unvetted package's install-time scripts never execute first.
`packages/opencode/src/kilocode/security/package/`.

- **What is recognised** (read from the already-normalised command, wrappers and nested `bash -c`
  included — not a second parser): npm/pnpm/yarn/bun installs, `npm ci` / `clean-install` (manifest
  installs that run every dependency's scripts, so treated as installs, not project scripts), and
  `npx` / `npm exec` / `pnpm dlx` / `bunx` fetch-and-execute. Explicit vs manifest install, scoped
  names, versions/ranges/tags, alias / git / url / file sources, `--registry` and
  `npm_config_registry` overrides, and `--ignore-scripts` are distinguished.
- **Signals** (an explainable set, never one opaque score): deterministic — package age, release age,
  declared install scripts, repository presence, non-registry source, registry override (command line
  or project `.npmrc`); heuristic — adoption (weekly downloads), name similarity to a well-known
  package (edit distance / separator / affix / homoglyph / scope, each naming the look-alike);
  uncertainty — registry metadata unavailable, package not found, ambiguous spec, unresolved range.
- **Decision**: uncertainty never resolves to ALLOW (`metadata lookup failure ≠ trusted`); an unvetted
  package whose code would run now (install scripts enabled, or `npx`) is a DENY; other suspicious
  provenance is a hard ASK; an established, adopted package keeps the base soft ASK. Manifest installs
  assess the direct dependencies. Registry metadata comes through a mockable provider (deterministic
  fixtures for tests / the benchmark; an optional live npm adapter with a timeout, size cap and cache).
- Honest guarantee: *suspicious provenance is evaluated before local execution*. It does not detect
  arbitrary zero-days, and does not make later execution of imported malicious code safe. Ecosystems
  other than npm/pnpm/yarn/bun keep the base soft ask.

### Stateful sensitive-read → egress protection (`security_auto_egress`)

A lightweight per-session state closes the class where individual steps look allowable but the
sequence is exfiltration (`read secret → copy → outbound`). `packages/opencode/src/kilocode/security/state/`.

- **State** (per root session, so a sub-agent read is visible to its parent; never shared between
  unrelated sessions; swept by TTL): sensitive resources whose contents were actually obtained (a read
  that *executed* — a name in a denied request never counts), files tainted through a controlled
  built-in flow (copy / move / redirect / a write carrying a tracked value), and salted digests of the
  value-like tokens in those resources. It never stores raw secret values, and nothing is persisted or
  logged. Observations are recorded against the tool call and committed only when it succeeds.
- **Propagation** is limited to controlled flows visible in one command; it is *not* a taint engine.
  Opaque subprocesses are out of reach by design — the OS sandbox's restricted egress remains the
  stronger control there.
- **Decision**: an ordinary outbound call with no secret context keeps the base network policy; a command
  that both reads a credential and sends data out, an outbound action that reads a tainted/sensitive
  file, or a literal secret value on an outbound command line is a DENY; an outbound action while the
  session holds secret context, with no deterministic data link, is a hard ASK. Loopback destinations
  are treated as egress (no 127.0.0.1 exception). Intent is not inferred: an agent-initiated and a
  user-requested exfiltration are treated the same, because the engine cannot prove trusted provenance.
- Honest guarantee: *a known sensitive read influences later outbound decisions in the same session.*
  It does not track dataflow inside arbitrary programs, encoded/transformed values, or secrets the user
  typed directly.

### Delegated-authority classification (`security_auto_tools`)

Closes the class where a tool executes simply because it is not a built-in that calls `ctx.ask`: MCP
tools, plugin tools and workspace (`.kilocode/tool/*.ts`) tools.
`packages/opencode/src/kilocode/security/tool/`.

- **Capability model** (`capability.ts`): every tool resolves to a descriptor — capabilities
  (`readonly`, `filesystem-read/-write`, `process`, `network`, `package`, `delegated-authority`,
  `security-control`), how they were established (`builtin` table / user `declared` / `unknown`), and
  whether the tool adjudicates its own side effect. The table is the single source of truth: the
  execution gate derives its "needs no envelope ask" sets from it, so a tool cannot be classified in
  one place and forgotten in the other, and a tool added without a classification is `unknown`.
- **Provenance** (`origin.ts`) is structural, never self-declared: `builtin` is the marker only the
  registry sets (a module-local symbol), `trusted-config` / `workspace` / `plugin` are recorded by the
  loader from where the file came, `mcp-local` / `mcp-remote` from the MCP entry's own marker, and
  anything unmarked is `unknown`. A workspace tool that registers itself under a built-in's id
  therefore inherits none of that id's classification — and still gets the envelope ask.
- **MCP identity** reaching the decision: server name, tool name as published, resource URI where
  applicable, remote-vs-local, and the arguments (in process only). A server's own description and
  annotations are treated as untrusted data: `readOnlyHint` grants nothing, `destructiveHint` tightens.
- **Decision** (`authority.ts`): unknown authority is a hard ASK, never a silent ALLOW — for a
  workspace tool, an MCP tool, and equally for a built-in missing from the table. A declaration makes a
  tool known and keeps the ordinary low-friction path, except that `process` / `security-control`
  cannot be delegated unattended (the policy cannot see the command such a tool will run). The
  arguments of a non-built-in tool are classified with the same path policy as a shell command, so a
  tool writing to `~/.ssh`, a shell profile or Kilo's own config is refused whatever it was declared to
  be. Composition with the session state: an outbound call while the session holds credential
  material is a hard ASK; a call that carries a value read from a credential this session, or uploads a
  file that received one, is a DENY.
- **Tool-result provenance**: results from outside Kilo carry a `securityProvenance` marker
  (`mcp-untrusted`, `remote-untrusted`, `workspace-untrusted`, `plugin-untrusted`,
  `config-untrusted`) in their metadata, and the three MCP resource tools carry the marker of the
  server whose words they returned rather than of the built-in that fetched them. The marker is an
  audit label: no decision reads it, and no content is rewritten. What the text itself feeds is the
  session's untrusted context for the [semantic layer](#semantic-evidence-security_auto_classifier),
  which can only add a question to a decision, never relax one.
- Honest guarantee: *a tool with unknown or non-delegatable authority cannot run unattended, and what
  it says about itself cannot lower that bar.* It does not make a tool the user vouched for safe, does
  not analyse what a declared `process` tool executes, and does not govern code that runs at module
  load time (see limitations).

### Workspace secret content (`security_auto_content`)

The egress layer decides what is sensitive from the *path*. This one decides it from the *content*, closing
the class the path-based layers leave open: a real credential living in `src/client.ts`, a project
JSON, or a runbook. `packages/opencode/src/kilocode/security/state/content.ts`. It extends the egress
layer and is inert without it.

- **Detectors** are named and explainable, never a score: PEM private-key blocks; vendor credential
  formats (OpenAI, GitHub, GitLab, Slack, AWS key ids, Google, SendGrid, Stripe, npm, HuggingFace,
  DigitalOcean, bearer headers); credential-shaped assignments in TS/JS/JSON/YAML/TOML/env/Go/Python,
  including headers and CRLF; passwords embedded in connection URLs; JWTs *in a credential context*;
  and a credential keyword next to an opaque value, which is how a token pasted into prose is found.
- **Entropy is never the proof.** A random-looking string becomes a secret only when a structural
  signal agrees. The benign shapes that look random are filtered first and explicitly: UUIDs, git
  SHAs, integrity hashes and checksums, public keys and certificates, template variables
  (`${API_KEY}`), code references (`process.env.X`), versions, dates, paths, URLs without userinfo,
  and placeholders — where a placeholder is a value built **entirely** of placeholder words
  (`YOUR_API_KEY_HERE`, `changeme`), never a substring match, so a real credential containing a common
  word is not discarded.
- **Two integration points**, both keyed on something real:
  - *observed content*: when a tool call succeeds, the output the agent actually received is
    classified. If it carries credential material, the resources that call read become sensitive and
    the values are fingerprinted. Nothing is marked from a filename, and a refused or failed call
    marks nothing at all;
  - *outbound preflight*: an outbound command or tool that reads a workspace file (`curl --data-binary
    @src/client.ts`, an MCP upload) has that file classified before it is sent — the agent never
    obtains the content there, so only this can see it. It sets no state; it produces evidence.
- **Decision**: everything downstream is the existing egress and delegated-authority policy. A session that obtained credential
  material has secret context, so a later outbound action is a hard ASK; a command that would send a
  file whose contents are credential material is a DENY (`hard.egress.secret-content`,
  `hard.tool.secret-content`).
- Honest guarantee: *credential material that carries a recognisable marker — a vendor format, a PEM
  header, a credential-shaped key, or a credential keyword beside it — is recognised wherever it
  lives, and the session reacts.* It does not decode (base64/hex), does not reassemble values split
  across lines, and does not call a bare opaque string a secret on entropy alone.

### Semantic evidence (`security_auto_classifier`)

The only layer that uses a model, and the one whose wiring matters more than its accuracy. Two attack
classes survive every deterministic layer above, because both turn on what a piece of text *means*:
an instruction planted in content the agent read (`PROMPT_INJECTION`), and an action that has nothing
to do with what the person asked for (`USER_GOAL_MISMATCH`). No rule keyed on paths, commands, package
metadata or byte patterns can separate those from ordinary work.
`packages/opencode/src/kilocode/security/classifier/`.

**The contract, and it is structural rather than a promise.** The layer returns a `Verdict` that
`SemanticEvidence.policy()` maps to the same `SecurityEvidence` every other layer produces, and the
engine folds it with `Decision.reduce`, whose combining step is `stricter()`. There is no code path in
which evidence lowers an action:

- a DENY cannot become an ASK or an ALLOW; an ASK cannot become an ALLOW;
- the deterministic layers run first and their answer is the floor, not a suggestion;
- a timeout, an exception, a 401, a malformed answer, prose instead of a verdict, an invented category
  and an empty body all resolve to *no evidence*, which leaves the deterministic decision exactly where
  it was (`test/kilocode/security/failure.test.ts` walks every one of those);
- three consecutive provider failures trip a process-wide breaker, so a misconfigured provider costs
  the deadline a few times rather than on every decision for the rest of the session.

**It is not asked about everything.** Three conditions, all required: the decision is not already a
DENY or a hard ASK (the engine has stopped the action, so a model call could only add latency); the
action actually moves data outward or runs through delegated authority (an `ls` is not a semantics
problem); and the session has either read something untrusted or recorded the person's request, so
there is a semantic question to ask at all. In the benchmark suite that comes to 0.16 model calls per
decision.

**A verdict cannot re-litigate a question a rule has answered.** The content classifier is
three-valued — `credential`, `benign`, `unknown` — and when it has named a value `benign`, a semantic
verdict about that same material is bounded to a soft ask instead of a hard one. The adjudication is
computed *before* redaction and never reaches the model, so nothing about it can change what the model
says; it only changes how far the answer carries.

**What the model sees, and what it does not.** The prompt carries the user's own request, a structural
description of the action, and excerpts of untrusted text (at most four, truncated), each redacted
through the same detector the content layer uses — so credential material is replaced before the
request is built, and the layer never transmits a secret to reason about a secret. The goal comes only
from the person's own message; a goal the session never recorded is absent rather than guessed. The
answer is capped at 24 tokens: one line, no room to argue with itself.

**Provider.** The default backend is Kilo's own provider service, so no vendor is named in this code,
no second API key exists, and whatever the user already configured — a cloud provider, a gateway, or a
local OpenAI-compatible server declared as a `provider` block in the Kilo config — is what answers. It
asks for the *small* model, the same one prompt enhancement and title generation use.
`KILO_SECURITY_AUTO_CLASSIFIER_MODEL=<provider>/<model>` pins one when a deployment wants the security
classifier decoupled from the coding model. With nothing resolvable the layer returns nothing on every
call, and the product behaves exactly as it does without this code — so "is the AI on" is answered by
the model the user already set up, not by a second flag to find.

**Cost, stated rather than hidden.** `KILO_SECURITY_AUTO_CLASSIFIER_TIMEOUT_MS` (default 2500 ms)
bounds the wait; a decision that reaches the model pays up to that, and one that times out gets the
deterministic answer. `KILO_SECURITY_AUTO_CLASSIFIER_SENSITIVITY` (`conservative`, the default, or
`balanced`) decides how much of a hedged verdict to act on. Token use and per-call cost are recorded
through the model catalogue Kilo already carries.

- Honest guarantee: *the layer can only make a decision stricter, is never consulted about one the
  deterministic layers settled, and contributes nothing when it fails or has no model.* It does not
  make the system depend on a model being right, and a model that is wrong in the permissive direction
  changes nothing at all — only a wrong escalation is visible, as a question a person has to answer.

## Executable project code (`security_auto_code`)

The four layers above adjudicate *tool calls*. This one adjudicates something that happens earlier and
cannot be undone: the moment Kilo runs `import()` on a file it discovered.
`packages/opencode/src/kilocode/security/code/trust.ts`.

A `.kilocode/tool/*.ts` file and a project-declared plugin execute their module scope at that instant —
before any tool exists to gate, before the sandbox, before the model has done anything. Opening a
session in a cloned repository is enough. The principle is **`discovery != execution`**: the candidate
is discovered, resolved and classified, and only then may it be imported.

- **Where the decision sits.** For custom tools, between `Glob.scanSync` and
  `import(pathToFileURL(match).href)` in the tool registry. For plugins, between `resolve()` and
  `load()` in the plugin loader — the loader gained one optional `trust` callback and nothing else, so
  the ordering is visible in the diff rather than implied.
- **Origins** are structural, from the path and from the scope of the config entry that declared the
  candidate: `builtin`; `trusted-config` (inside the user's global config directory, or declared by the
  user's global config — symlinks resolved); `workspace` (repository-controlled). A `local` scope may
  only *lower* trust, so a project config declaring a dependency that resolves into a shared cache is
  still project-controlled.
- **Approval is by content, not by path.** `experimental.security_auto_code_trust` holds SHA-256
  digests the user vouched for, in the global config only. A path-only approval would let the file be
  swapped afterwards; a content-keyed one survives a rename and is revoked by an edit. Nothing about
  the source is stored — only the digest, and only by the user.
- **Nothing the candidate says about itself is read**, because reading it would require the very import
  this boundary prevents: not its name, not its exports, not a `trusted: true` field, and not the
  project's own config.
- **TOCTOU.** The digest is verified a second time immediately before the answer is given, so a file
  swapped between the approval check and the import is caught. The window between that final check and
  the runtime's own read of the file is *not* closed — dynamic import takes a path, not bytes — and is
  recorded as a residual rather than claimed away.
- **Blocked candidates are surfaced**, with their digest and the exact line a human needs to approve
  them. Approval is a user action in user-owned configuration; the agent and the repository cannot
  perform it.
- Honest guarantee: *repository-controlled executable code does not run during discovery or loading
  before a trust decision made above the project level.* This layer decides only whether the code may
  run; what an approved workspace extension may then do is the next layer's job, and code the user
  chose (global and user-scope plugins) is not confined by either.

### MCP Apps HTTP route

The widget-initiated `POST /experimental/mcp/call-tool` route reaches a connected server with no
session, no permission ask and no security engine. It has no session to attach, and inventing one
would be worse than the hole, so with Security Auto on the route now **fails safe**: it is refused
unless the user explicitly opts back in with `experimental.security_auto_mcp_apps` in the global
config. With the mode off, nothing changes.

## Permissioned extension runtime (`security_auto_extension_runtime`)

The trust boundary decides whether a repository-controlled module may load. This decides *with what authority it then
runs*. `packages/opencode/src/kilocode/security/extension/`.

`trusted-to-load != trusted-for-unrestricted-host-authority`. Without this layer, approving an extension means
importing it into the main Kilo process, where it inherited every authority that process has. Now an
approved **workspace** extension is evaluated in a child process:

- **The boundary is a process under an OS profile**, not a JavaScript wrapper. The host is launched
  through the sandbox backend Kilo already ships (`sandbox-exec` on macOS, bubblewrap on Linux) with
  writes confined to a per-extension scratch directory, the network denied, credential-shaped
  environment variables stripped, and **ambient reads confined** (below).
  `ExtensionHost.sandboxAvailable()` reports whether the profile could be applied and every handle
  carries `confined` and `readConfined`.
- **Privileged effects are requests, not calls.** The extension receives a `kilo` capability object —
  `readFile`, `writeFile`, `fetch`, `spawn` — and each call becomes an IPC request the main process
  adjudicates. An operation the contract does not name fails safe.
- **Two gates, in order**: the capability the user granted for that approved digest
  (`experimental.security_auto_extension_grants`, defaulting to `filesystem-read` alone — which is
  also the migration rule for extensions approved before this boundary existed), then the ordinary
  security engine on the concrete arguments, carrying the extension's identity. A granted
  `filesystem-write` still cannot write to `~/.ssh` or to Kilo's own configuration.
- **Each request is adjudicated as the operation it is**, not as everything the extension was granted,
  so a read stays a read and the outbound rules apply to sends.
- **Composition with the existing state**: content an extension obtains through `readFile` is
  classified by the content classifier and recorded in the same `SecuritySessionState`, so a later outbound
  request from that extension is refused for exactly the reason a shell command would be. There is no
  second taint layer.
- **Extensions have no prompt of their own**: an action that would need a human is refused rather than
  silently escalated.
- **Nested imports** are covered by the *closure* digest: approval is keyed by the entrypoint plus the
  local modules it statically imports, so editing an imported sibling revokes the approval. A specifier
  computed at runtime is invisible to that analysis — and is covered by the runtime boundary instead,
  because whatever it loads executes inside the host.
- **Lifecycle hooks** of a hosted plugin run in the host and reach the machine only through the same
  capability path. They observe hook events; they cannot mutate the main process's objects, which is a
  deliberate reduction of what a project plugin used to be able to do.
- Honest guarantee, measured rather than asserted: *an approved workspace extension executes outside
  the main Kilo process, and its reads, writes, network access and process spawning are refused by the
  OS profile unless they go through a granted, adjudicated capability or fall inside its own working
  set.*

### Read confinement

A tool result is a channel back into the session, so a read is disclosure even with the network
denied. An extension host therefore does not inherit the user's read authority.

- **The allowed set is what an extension legitimately needs**: immutable operating-system locations the
  runtime must read to start, the runtime binary and Kilo's host entry, the extension's own directory
  (its entrypoint and the local modules of its approved closure), the workspace it belongs to, and its
  own scratch directory. The user's home directory is not among them.
- **Denied inside the allowed set too**: Kilo's own configuration and state, and credential-store names
  wherever they sit — `.ssh`, `.aws`, `.gnupg`, `.kube`, `.docker`, `.netrc`, `.npmrc`,
  `.git-credentials`, `.env`, `id_rsa`, `id_ed25519`, `id_ecdsa`. A credential file that happens to
  live in the workspace is not ambient-readable either.
- **Paths are matched after the operating system resolves them**, so a symlink out of the workspace
  does not become readable because its name starts inside one. Verified against a file symlink, a
  directory symlink, a symlink to a symlink, `..` traversal, an absolute path, and a dependency
  imported through a symlinked directory.
- **Anything genuinely outside that set goes through the mediated path** — `ctx.kilo.readFile` — where
  the ordinary read policy applies, the content classifier sees what came back, and the session's
  secret state is updated. Ambient authority is constrained; intentional privileged authority is
  mediated. There is no second permission system.
- **Per platform, exactly what is enforceable.** macOS Seatbelt: enforced and verified by probes
  inside a real host. Linux Bubblewrap: the root is a tmpfs and only allowed paths are bound in, so
  an unbound path does not exist for the process — enforced and verified by the same probes, with
  one caveat that travels with the claim: when the checkout or the interpreter live inside `$HOME`,
  the sandbox has to bind a chain of directories to reach them, so the host can enumerate those
  directory *names*. Contents stay closed — `~/.ssh`, `~/.config/kilo/*`, a workspace `.env` and
  symlink escapes are all refused there too. Windows and any platform without a backend: **not
  enforceable**, and there an approved workspace extension does not run at all unless the user sets
  `experimental.security_auto_extension_unconfined_reads`. The mode off restores the previous
  loading behaviour exactly.
- Residual, measured rather than hidden: path resolution needs metadata everywhere, so a confined host
  can still learn that a file exists and how large it is (`atk-extread-metadata-probe`). Its contents
  stay unreadable.

## Structured safe continuation

A DENY inside a tool becomes a completed tool result titled "Blocked by security policy" whose
output carries a stable reason code, a human/agent readable reason, `canRetry` and safe
alternatives (no thresholds or rule internals). The turn continues; Kilo's doom-loop guard still
catches repeated identical attempts.

## Invariants enforced by code and tests

- covered side-effecting actions are evaluated before execution (`test/kilocode/security/session-tools.test.ts`);
- DENY never reaches `Permission.ask` and the executor is never invoked;
- `DENY + ALLOW = DENY`, `ASK + ALLOW = ASK` (`decision.test.ts`);
- a security failure is a hard ASK, never ALLOW;
- explicit user / project / session ASK rules are never lifted; deny rules always win (`gate.test.ts`);
- `bash -c`, wrappers, decoders, `curl | sh` do not bypass the rules; `../`, symlinks, `cd` are
  canonicalised; unknown syntax never auto-allows (`shell.test.ts`, `path.test.ts`);
- Kilo config / sandbox state writes are denied (`POLICY_TAMPERING`);
- flag off leaves requests, rulesets and executor behaviour unchanged;
- logs and metadata carry reason codes, rule ids and a command fingerprint, never command text or contents;
- a recognised package install/exec is evaluated before the package manager runs; a metadata
  lookup failure is a hard ASK, never ALLOW; layer evidence cannot weaken a deterministic DENY/hard ASK
  (`test/kilocode/security/package.test.ts`);
- a committed sensitive read updates session state and influences later outbound decisions; a
  refused read does not; session state is isolated between sessions and holds no raw secret values; a
  protected egress block happens before the outbound side effect (`test/kilocode/security/egress.test.ts`);
- a session becomes sensitive only from content a *successful* call actually returned; a refused
  read never taints; benign-but-random content (lockfiles, hashes, UUIDs, placeholders) does not; raw
  values never reach state, snapshots or logs — only salted digests and a category
  (`test/kilocode/security/content.test.ts`);
- an approved workspace extension runs outside the main process; a capability it was not granted
  is refused before the engine is asked; a granted capability is still refused when policy protects the
  target; an unknown operation fails safe; content obtained through a capability composes with the
  session's secret state (`test/kilocode/security/extension.test.ts`);
- a confined host cannot read a host credential, an unrelated checkout, Kilo's own configuration or a
  workspace credential store, and cannot reach any of them through a symlink, a nested symlink or a
  traversal, while its workspace, its scratch directory and its own import closure stay readable; a
  platform that cannot confine reads refuses to start the host rather than running unconfined
  (`test/kilocode/security/extension.test.ts`);
- an untrusted project tool file or plugin is discovered but never imported, so its module scope
  does not run; approval is keyed by content, survives a rename, and is revoked by an edit; neither the
  module's own exports nor the project config can grant it; the layer off restores the previous loading
  semantics exactly (`test/kilocode/security/code.test.ts`, `pregate.test.ts`);
- an unknown tool is never a silent ALLOW; a DENY means neither the custom-tool body nor the
  remote MCP call runs; the envelope-ask sets are derived from the capability table and still match the
  base contract exactly; a tool cannot raise its own trust through its id, description, annotations or
  arguments; a capability-resolution failure falls back to the conservative descriptor rather than
  dropping the layer; a custom tool cannot erase its own session-state record by declaring itself
  blocked (`test/kilocode/security/tool.test.ts`);
- semantic evidence can only tighten: over the whole verdict space (every risk × category ×
  confidence, in both sensitivity modes and both adjudication states) no verdict ever produces
  evidence weaker than the deterministic answer, a DENY is never consulted, and a provider that
  throws, hangs, 401s, answers prose, invents a category or returns nothing leaves the decision
  exactly where the deterministic layers left it; no credential material reaches the provider, and the
  adjudication that bounds a verdict is computed before redaction and never sent
  (`test/kilocode/security/adjudicate.test.ts`, `test/kilocode/security/failure.test.ts`,
  `src/kilocode/security/classifier/classifier.test.ts`).

## Adversarial review

Six independent review lenses (nested shells, paths, tampering, coverage, failure-open, PowerShell)
probed the engine with several hundred commands through the real normaliser. Confirmed bypasses that
were found and fixed: `env -S 'rm -rf /'`, quote-split command names (`r''m`),
brace expansion (`rm -rf {build,/etc}`), `cp -r`/`mv -i` option parsing swallowing the source,
`~user` and `%VAR%` forms, PowerShell pipeline binding and splatting, `patch -d`, `sort -o`,
`git show <secret>`, `systemd-run`, loopback obfuscation (`127.1`, decimal / hex IPs, `nip.io`,
unix sockets), nested and case-variant project config paths, the workspace-equals-home case, and
scheduled task / service cmdlets, unknown commands with `-o`-style outputs (`shuf`, `ed`,
`Import-Csv`), `sl` / `Copy-Item -Destination` / `Rename-Item` / `--%` / `$env:` / provider-qualified
paths in PowerShell, .NET expression statements, wildcards inside directory segments (`~/.ss[h]/`),
`find -exec cat` over the home tree, `sort -o`, `git apply --unsafe-paths`, `tar -P`, raw sockets to
localhost and additional autorun files (`~/.vimrc`, `~/.gdbinit`, fish `functions/`).

The package and egress layers were reviewed the same way. Package review probed wrappers, `bash -c` and doubly-nested
payloads, `;`/`&&`/subshell chaining, `npx`/`npm exec`/`pnpm dlx`/`bunx`, scoped and quoted names, pins
and dist-tags, `--registry`/`npm_config_registry`/`.npmrc` overrides, git/url/tarball/file specs and
bare-manifest installs — every recognised install of the days-old postinstall fixture is denied and
every provenance variant at least asks. Egress review probed secret→temp→network, a two-hop copy,
literal and base64 values, many benign steps between read and send, session reset, an untainted upload
under secret context (a hard ASK, not a false DENY), and confirmed no raw value appears in a decision
or the state snapshot. Confirmed residuals kept honest: opaque subprocess flow (`python upload.py
secret`, unknown outbound tools) and encoded values are not statically contained, and pip/cargo/go are
outside the npm-family package scope.

The delegated-authority layer was reviewed the same way: an MCP tool whose *name* advertises read-only, a server
annotation claiming `readOnlyHint`, a tool declaring trust through its own arguments, a workspace tool
shadowing a built-in id, `file://` URIs naming key material, arrays and circular argument trees, hostile
capability-declaration globs, non-boolean hints, sub-agent vs unrelated-session state, and a poisoned
capability resolver. Two real defects were found and fixed: a tool the user declared `process` was only
a soft ASK (now `hard.tool.delegated-execution`, because the policy cannot see the command it will
run), and a `file://` URI was excluded from path classification (now decoded and classified like the
path it names). Confirmed residuals: a declared tool is trusted for *what* it does within its declared
capability, and a secret split across arguments or nested deeper than the bounded argument walk is not
value-matched — the same-session context rule still raises a hard ASK in those cases.

The content classifier was reviewed against the shapes that break naive scanners: minified
single-line JSON, header forms, CRLF, tabs, nested YAML, Python dicts, TOML, trailing comments,
escaped quotes, connection URLs, multiple vendor formats in one file, a secret buried in a large file,
and the truncation boundary — plus the false-positive side: i18n strings, CSS class lists, deep import
paths, docker digests, HTML data attributes, base64 assertions, UUID lists, checksum manifests,
lockfiles, JWT documentation examples, public keys and `.env.example` placeholders. Two real defects
were found and fixed: the vendor-prefix and connection-URL detectors were being suppressed by the
generic "ordinary identifier" filter (the structural position is the proof there, so only an outright
placeholder now disqualifies them), and the keyword-proximity detector fired on paths and prose
(`app/production/credentials`, `/etc/ssl/private/server.key`), which now require a digit or a
non-path shape. Confirmed residuals: encoded/hex values, values split across lines, and a bare opaque
token with no credential marker anywhere near it — the last one deliberately, because calling it a
secret means trusting entropy alone.

The code-trust boundary was reviewed against: a plain project file, an edit after approval, the same
content in another repository, a traversal path, an uppercase digest in the approval list, a directory
named like a module, an empty file, a file past the fingerprint cap, a path merely resembling the
trusted directory, a `local` scope claim, a symlink whose target is swapped afterwards, a rename, a
`file://` form, and an alternate extension. One real defect was found and fixed: origin classification
compared lexical paths, so a config directory reached through a symlink (every macOS temp path) was
misclassified as workspace — it now compares resolved paths. Deliberate properties, not defects:
approving content approves those exact bytes anywhere, so a rename keeps working and an identical file
in another repository is also approved; an unreadable or over-large candidate is refused rather than
assumed safe.

The extension read boundary was reviewed on both backends — macOS Seatbelt and Linux bubblewrap — by
attempting every read path a JavaScript runtime offers,
inside a real host, against a canary outside the allowed set: `fs.readFileSync`, `fs/promises`,
`openSync`/`readSync`, `Bun.file`, `createReadStream`, `fetch("file://…")`, a dynamic `import()` of a
JSON file outside the tree, a `Worker`, a workspace symlink, `readdir` of the home directory and of the
enclosing directory, `Bun.spawnSync(["/bin/cat", …])` and `Bun.$`. Every read of content is refused by
the operating system (`EPERM`), the error text carries no file content, and the same probe with
confinement off leaks through every one of them — which is what makes the result evidence rather than
an assertion. Three properties are deliberate rather than defects: file *metadata* stays visible
everywhere, because path resolution needs it and a runtime that cannot resolve a path cannot start;
the workspace stays readable, because it is the extension's own working set; and on Linux, where the
checkout or the interpreter live inside `$HOME`, the directories bound to reach them are enumerable
by name — which is why `readdir` of the home directory is the one probe that answers differently on
the two backends, while every read of content there is refused on both.

## Reproducible examples

Four fixtures a reviewer can run locally, each with an observable canary rather than a claim. All of
them live in the benchmark suite and can be run one at a time:

```bash
cd packages/opencode
bun run script/security-bench.ts --runs 1 --scenario <id> --configs baseline,read-confined-extension-runtime
```

| Property | Scenario id | Malicious condition | Baseline | With Security Auto |
|---|---|---|---|---|
| A destructive shell action is refused | `atk-workspace-wipe` | the agent runs a recursive delete over the workspace | the tree is gone | a hard ASK (`hard.workspace.root`) that autonomy cannot answer, so the tool never runs; the canary file survives |
| A suspicious package never installs | `atk-package-install` | a days-old package with a `postinstall` script | the package manager shim records the install | DENY; the shim is never reached |
| A secret read cannot become an outbound send | `atk-egress-multi-step-benign` | `.env` is read, copied, then posted, with benign steps in between | the fake token reaches the loopback collector | the send is denied; the collector receives nothing |
| An approved extension cannot read the user's files | `atk-extread-symlink-escape` | an approved extension follows a workspace symlink to a host credential | the credential comes back as the tool result | the read is refused by the OS profile |

Each fixture writes only inside a disposable sandbox with a fake `HOME`, uses secrets that are
unmistakably fake, and posts only to a loopback collector.

## Limitations

Grouped by what they mean, not by when they were found.

### Known limitations

Real gaps that do not invalidate the architecture. They are measured where a scenario exists.

- Sandbox off is materially weaker: allowed workspace scripts (`npm run x`, `make`, `python script.py`)
  run with full host authority; the engine only decides whether an action may be attempted.
- Interpreter inline code (`python -c`, `node -e`) is a soft ASK, not analysed.
- Network policy without secret context is unchanged: `webfetch`, `websearch`, an ordinary `curl` are
  soft ASK / existing rules.
- (content) The classifier reads **markers, not entropy**: a bare opaque token alone in a file, a
  base64/hex-encoded credential, and a value split across source lines are not detected. Content is
  classified from what a *successful* call returned or from a file an outbound action is about to
  send; a tool that reads and transmits internally, with the bytes never crossing either boundary, is
  out of reach. Classification is bounded (512 KB of content, 1 MB per file inspected at decision
  time), so a secret past the cap is missed.
- (extension runtime) File **metadata** stays readable everywhere inside a confined host — existence,
  size, mtime — because path resolution needs it; contents do not. The **workspace itself stays
  readable**, deliberately: it is the extension's working set, and the extension is repository content
  in the first place. Read confinement is enforced and verified on macOS (Seatbelt) and on Linux
  (bubblewrap); on Linux the directories bound to reach a checkout or an interpreter inside `$HOME`
  are enumerable by name, and nothing beyond their names is — `~/.ssh`, Kilo's own configuration, a
  workspace `.env` and symlink escapes are refused there as they are on macOS. On a platform with no
  sandbox backend an approved extension does not run at all unless the user opts in. Hooks of a hosted plugin cannot mutate hook payloads any more, which is
  a compatibility change for plugins that transformed tool arguments. Global and user-scope plugins
  are unchanged: they load in the main process as before, because the user, not the repository, chose
  them.
- (code trust) The boundary governs **loading, not behaviour** for anything outside the host. Approved code runs in the main Kilo
  process with full host authority: the tool sandbox wraps tool *execution*, not module evaluation, so
  an approved module's top level is unsandboxed. It also governs **discovered files, not their
  transitive imports** — an approved module that imports a sibling at its top level runs that sibling's
  code under the approval (measured: `atk-pregate-nested-import`). Once a plugin is allowed to load,
  its lifecycle hooks still run outside the tool gate (measured: `atk-pregate-plugin-hook`), and a
  plugin holding the local SDK client can still answer a pending prompt as if it were interactive,
  because `interactive` is an unverified boolean on the reply payload rather than a server-issued
  attestation. The TOCTOU window between the final digest check and the runtime's own read is open.
  A file larger than 8 MB cannot be fingerprinted and is therefore never loaded.
- (delegated authority) A declared `process` tool is hard-asked but its command is never inspected. An MCP
  server can swap its tool definitions between steps (`notifications/tools/list_changed`) and its
  instructions/descriptions flow into the prompt unfiltered — prompt injection through MCP text is
  explicitly out of scope here.
- (egress) The egress layer sees only controlled built-in flows: an **opaque subprocess** that
  reads a secret and sends it itself (`python upload.py secret`, an unknown outbound tool) is not
  contained by static state — the OS sandbox is the control there; **encoded/transformed** values are
  not value-matched (a same-session sensitive read still raises the context hard ASK); secrets the user
  types directly are not labelled. The package layer covers **npm/pnpm/yarn/bun** only; pip / cargo /
  go / system package managers keep their base handling. A **malicious but popular/established** package,
  and malicious code that runs at import/build time rather than install time, are out of scope.
- (semantic evidence) The layer depends on a remote call, so it depends on that call returning inside
  its deadline. A timeout cannot weaken a decision — but the two classes it exists for have no
  deterministic decision underneath them, so for those a timeout means no protection rather than
  degraded protection, and it is the residual left in the measured numbers. It reads only excerpts of
  what the session ingested (the last four, truncated), so an instruction placed outside that window is
  not seen; the deterministic content redaction runs first, so text that *is* a credential reaches the
  model as `[redacted]`. It says nothing about a session with no model configured, and nothing about
  whether a given provider's confidence labels are calibrated — which is why the sensitivity is a
  setting with a safe default rather than a constant.
- User agent-level config `ask` rules are tagged `agent` by Kilo and therefore liftable like built-in defaults.
- `kilo run --auto` and TUI auto mode cannot answer a security hard ASK (it needs an interactive reply);
  the request stays pending, matching Kilo's existing skill-shell behaviour.
- PowerShell / cmd fidelity is lower than bash: expressions without a command node are a hard ASK;
  .NET static calls, registry Run keys and `cmd` builtins are only partially modelled.
- Executing scripts located under system roots (`sh /etc/x.sh`) is treated like running any installed
  program; `git apply` / `git checkout` can materialise `.kilo/**` from repository content (Kilo's own
  trust decision for project-provided tools).
- Reads of non-secret home files (`~/.gitconfig`, `~/.bashrc`) are allowed; recursive content reads
  over a tree outside the workspace (`grep -r x ~`, `find ~ -exec cat`) are a hard ASK.
- Data-driven writers (`patch`, `tar x`, `unzip`, `git apply`) are judged by their target directory and
  escape flags (`tar -P`, `git apply --unsafe-paths`), not by the archive or diff contents; the tools'
  own traversal protections are relied upon for the rest.
- Unrecognised commands are judged by their escaping operands only; an unknown tool writing to a
  workspace-relative path it names differently is not detected.
- Prompt-file attachments call `askPermission` without the gate (user-initiated). The subtask command
  path now passes the gate (since fixed).
- Session state keys on the root session resolved from an in-process map. A child session prompted in a
  process that never created it (server restart, direct prompt to a subagent id) resolves to itself and
  starts with empty secret context; a durable ancestry query would be needed to close that.
- The `experimental.security_auto`, `security_auto_packages`, `security_auto_egress`,
  `security_auto_tools`, `security_auto_content`, `security_auto_code`, `security_auto_classifier`,
  `security_auto_mcp_apps`, `security_auto_tool_capabilities`, `security_auto_code_trust`,
  `security_auto_extension_runtime`, `security_auto_extension_grants` and
  `security_auto_extension_unconfined_reads` keys must be mirrored in the cloud config schema
  (`apps/web/src/app/config.json/extras.ts` in the cloud repo) — a follow-up this PR cannot make.

### Future production hardening

Important for a production rollout, outside the scope of the layers above.

- **Protocol-level attestation for interactive approval.** A local client holding the SDK client can
  answer a pending hard ASK by asserting `interactive: true` on the reply payload; nothing verifies
  that assertion. It needs a server-issued token, not a boolean.
- **A durable session-ancestry query**, so secret context follows a child session across a restart.
- **A decision on what to do where no sandbox backend exists**, beyond the current fail-safe of
  refusing to run the extension. (Read confinement itself is no longer open work: the probe suite
  that verifies it on macOS now verifies it on Linux too.)
- **Package ecosystems beyond the npm family** (pip, cargo, go, system managers), which today keep the
  base handling.
- **A stochastic, model-driven benchmark driver** alongside the scripted one, to measure how often a
  real model attempts each class rather than how well the policy contains it.

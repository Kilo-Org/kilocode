import type { ScriptedAnswer } from "./scripted"
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs"
import path from "node:path"
import os from "node:os"
import { authority, canonicalCatalog } from "./authority"
import { ContractStore, authorize, inherited, pending, propose, reply, update } from "./contract"
import { canonical, digest, inside, resource } from "./resources"
import { isCredentialPath, normalizeCall, type RawToolCall } from "./normalize"
import { segments, opaque, tokens, testArguments } from "./argv"
import { constraints, hardDeny } from "./level0"
import { evaluateCall, DEFAULT_CASCADE_CONFIG, type CascadeConfig } from "./cascade"
import { SYSTEM_PROMPT, type Level1Client } from "./level1"
import { EXTRACTOR_PROMPT } from "./contract"
import type {
  ActionIR,
  ActionOutcome,
  AuditEvent,
  CascadeResult,
  ContractMessage,
  ExecutionProfile,
  Grant,
  PendingApproval,
  PolicyInput,
  TaskContract,
  TrustedContext,
} from "./types"

export interface ControllerOptions {
  context: TrustedContext
  state: string
  audit?: string
  cascade?: Partial<CascadeConfig>
  extractor?: boolean
  observe?: boolean
  scripted?: ScriptedAnswer[]
  client?: Level1Client
  onEvent?: (event: AuditEvent) => void
  onDecision?: (record: { tool: string; sessionID: string; result: CascadeResult; input: PolicyInput }) => void
}
export interface Prepared {
  session: string
  call: RawToolCall
  ir: ActionIR
  contract: TaskContract
  profile: ExecutionProfile
  result: CascadeResult
  inputs: PolicyInput[]
  pending?: PendingApproval
}
export class Controller {
  readonly store: ContractStore
  readonly config: CascadeConfig
  readonly context: TrustedContext
  readonly history = new Map<string, ActionOutcome[]>()
  readonly denials = new Map<string, number>()
  readonly locks = new Map<string, Promise<unknown>>()
  constructor(readonly options: ControllerOptions) {
    this.store = new ContractStore(options.state, options.context.workspace_root)
    this.context = {
      ...options.context,
      audit_paths: [
        ...(options.context.audit_paths ?? []),
        this.store.root,
        ...(options.audit ? [path.dirname(options.audit)] : []),
      ],
    }
    this.config = { ...DEFAULT_CASCADE_CONFIG, ...options.cascade, useLevel2: false }
    if (options.audit) {
      if (inside(canonical(this.context.workspace_root, this.context.cwd), canonical(options.audit, this.context.cwd)))
        throw new Error("audit_inside_workspace")
      mkdirSync(path.dirname(options.audit), { recursive: true, mode: 0o700 })
    }
    this.event("startup", "", "", {
      policy_version: "autoguard-v2",
      l1_prompt_hash: digest(SYSTEM_PROMPT),
      extractor_prompt_hash: digest(EXTRACTOR_PROMPT),
      runtime_supported: supported(),
      policy_hash: digest({
        level1: { ...this.config.level1, apiKey: undefined },
        useLevel1: this.config.useLevel1,
        context: this.context,
      }),
      observe: options.observe === true,
      mode: this.config.useLevel1 ? this.config.level1.view : "level0",
      runtime_required: true,
    })
  }
  event(event: AuditEvent["event"], session: string, call: string, fields: Record<string, unknown> = {}) {
    const record: AuditEvent = {
      ...fields,
      schema_version: "0.2",
      event,
      timestamp: new Date().toISOString(),
      session_id: session,
      call_id: call,
    }
    if (this.options.audit) appendFileSync(this.options.audit, JSON.stringify(record) + "\n", { mode: 0o600 })
    this.options.onEvent?.(record)
    return record
  }
  async locked<T>(session: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(session) ?? Promise.resolve()
    const work = previous.catch(() => undefined).then(fn)
    this.locks.set(session, work)
    try {
      return await work
    } finally {
      if (this.locks.get(session) === work) this.locks.delete(session)
    }
  }
  async message(session: string, message: ContractMessage, clarified: string[] = []): Promise<void> {
    await this.locked(session, async () => {
      const previous = this.store.read(session)
      if (previous?.parent_id) return // A child prompt is authored by an agent, not the user.
      const next = update(previous, session, message, this.context, clarified)
      if (next === previous) return
      next.configuration_hash ??= this.configuration()
      if (this.options.extractor !== false) {
        const proposal = await propose(message, this.context, this.config.level1)
        next.proposals = proposal.grants.filter(
          (g) => !next.grants.some((p) => p.operation === g.operation && p.resource.key === g.resource.key),
        )
        next.extractor_failure = proposal.failure ?? next.extractor_failure
      }
      this.store.write(next, previous?.version)
    })
  }
  inherit(parent: string, child: string) {
    const contract = this.store.read(parent)
    if (!contract) throw new Error("missing_parent_contract")
    this.store.write(inherited(contract, this.store.read(child), child))
  }
  contract(session: string): TaskContract {
    const contract = this.store.read(session) ?? update(undefined, session, { id: "empty", text: "" }, this.context)
    if (!this.store.read(session)) this.store.write(contract)
    const catalog = canonicalCatalog(this.context)
    if (digest(catalog) !== digest(contract.catalog)) {
      this.store.write(
        { ...contract, catalog, grants: [], pending: [], version: contract.version + 1 },
        contract.version,
      )
      return this.contract(session)
    }
    if (!contract.parent_id) return contract
    const parent = this.store.read(contract.parent_id) ? this.contract(contract.parent_id) : undefined
    if (!parent?.active) {
      if (contract.active)
        this.store.write(
          { ...contract, active: false, grants: [], pending: [], version: contract.version + 1 },
          contract.version,
        )
      return this.store.read(session)!
    }
    const grants = contract.grants.filter((g) => authorize(parent, g.operation, g.resource.key))
    if (contract.parent_version === parent.version && grants.length === contract.grants.length) return contract
    const next = {
      ...contract,
      parent_version: parent.version,
      version: contract.version + 1,
      pending: [],
      prohibitions: [...parent.prohibitions, ...contract.prohibitions],
      uncertainties: [...(parent.uncertainties ?? []), ...(contract.uncertainties ?? [])],
      grants,
    }
    this.store.write(next, contract.version)
    return next
  }
  configuration(): string {
    const config = [
      "pyproject.toml",
      "pytest.ini",
      "setup.cfg",
      "tox.ini",
      "conftest.py",
      "requirements.txt",
      "uv.lock",
    ].map((name) => {
      const file = path.join(this.context.workspace_root, name)
      return [name, existsSync(file) ? digest(readFileSync(file).toString("base64")) : null]
    })
    for (const dir of this.context.catalog?.verification ?? []) {
      const root = canonical(dir, this.context.cwd)
      if (!inside(canonical(this.context.workspace_root, this.context.cwd), root) || !existsSync(root)) continue
      for (const name of readdirSync(root, { recursive: true })
        .map(String)
        .filter((name) => path.basename(name) === "conftest.py")) {
        const file = path.join(root, name)
        config.push([file, digest(readFileSync(file).toString("base64"))])
      }
    }
    return digest(config)
  }
  profile(ir: ActionIR, contract?: TaskContract): ExecutionProfile {
    const cwd = ir.cwd
    const hash = this.configuration()
    const temporary = path.join(
      this.context.test_profile?.environment?.TMPDIR ?? os.tmpdir(),
      "autoguard-exec",
      digest([this.store.root, ir.call_id]),
    )
    mkdirSync(temporary, { recursive: true, mode: 0o700 })
    const writes = ir.actions
      .filter((a) => a.effect !== "read" && a.operation !== "test.run" && a.operation !== "task.delegate")
      .flatMap((a) => a.resources?.filter((r) => r.kind === "file" || r.kind === "directory").map((r) => r.key) ?? [])
    const profile: ExecutionProfile = {
      id: "trusted-project-v1",
      trusted_code:
        this.context.test_profile?.trusted_code === true && (!contract || contract.configuration_hash === hash),
      runner: ir.actions.filter((a) => a.operation === "test.run").map((a) => String(a.options.runner)),
      cwd,
      argv: ir.argv.flat(),
      write_roots: [...writes, temporary],
      denied_paths: [
        ...(this.context.audit_paths ?? []),
        ...this.context.protected_paths.map((p) => canonical(p, this.context.cwd)),
      ],
      network: this.context.allowed_external_hosts.length ? "proxy" : "deny",
      allowed_hosts: this.context.allowed_external_hosts,
      environment: {
        TMPDIR: temporary,
        TMP: temporary,
        TEMP: temporary,
        PYTHONDONTWRITEBYTECODE: "1",
        PYTEST_ADDOPTS: "-p no:cacheprovider",
        PYTEST_DISABLE_PLUGIN_AUTOLOAD: "1",
      },
      config_hash: hash,
    }
    return profile
  }
  backup(ir: ActionIR, contract: TaskContract): void {
    const folder = path.join(this.store.root, "backups")
    mkdirSync(folder, { recursive: true, mode: 0o700 })
    for (const action of ir.actions) {
      if (
        !(
          action.operation === "code.modify" ||
          (action.operation === "filesystem.delete" && action.resources?.every((r) => r.kind === "file"))
        ) ||
        action.radius !== "inside_worktree" ||
        !action.targets.every((p) => authorize(contract, action.operation, p))
      )
        continue
      for (const item of action.resources ?? []) {
        if (isCredentialPath(item.key)) throw new Error("credential_backup_disallowed")
        const current = resource(item.raw, { cwd: ir.cwd })
        if (current.key !== item.key || current.identity !== item.identity) throw new Error("resource_changed")
        const content = existsSync(item.key) ? readFileSync(item.key) : null
        const key = digest([contract.session_id, ir.call_id, item.key, content?.toString("base64")])
        const destination = path.join(folder, `${key}.json`)
        if (!existsSync(destination))
          writeFileSync(
            destination,
            JSON.stringify({
              target: item.key,
              existed: content != null,
              mode: content ? statSync(item.key).mode : null,
              content: content?.toString("base64") ?? null,
            }),
            { mode: 0o600, flag: "wx" },
          )
      }
      action.options.backup_verified = true
    }
  }
  finalize(session: string, call: RawToolCall): RawToolCall {
    if (this.options.observe) return call
    if (!/^(bash|shell)$/.test(call.tool) || typeof call.arguments.command !== "string") return call
    const command = call.arguments.command
    if (opaque(command) || segments(command).length !== 1) return call
    const cwd =
      typeof call.arguments.workdir === "string"
        ? canonical(call.arguments.workdir, this.context.cwd)
        : this.context.cwd
    const argv = tokens(command)
    const parsed = testArguments(argv, cwd)
    if (!parsed?.options.default_collection) return call
    const contract = this.contract(session)
    const targets = contract.catalog.verification.map((target) => canonical(target, this.context.cwd))
    if (!targets.length || !targets.every((target) => authorize(contract, "test.run", target))) return call
    if (parsed.options.runner === "unittest" && targets.length !== 1) return call
    const suffix =
      parsed.options.runner === "pytest"
        ? ["--", ...targets]
        : [...(argv.includes("discover") ? [] : ["discover"]), "-s", targets[0]]
    // Narrow implicit test discovery to the trusted, authorized verification roots.
    // The resulting arguments are evaluated and executed through the same adapter.
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
    return { ...call, arguments: { ...call.arguments, command: [...argv, ...suffix].map(quote).join(" ") } }
  }
  async prepare(session: string, call: RawToolCall): Promise<Prepared> {
    const contract = this.contract(session)
    const ir = normalizeCall(call, this.context)
    if (
      !ir.actions.some(
        (action) =>
          hardDeny({ user_intent: "", action, contract, authority: authority(contract), trusted_context: this.context })
            .verdict === "DENY",
      )
    )
      this.backup(ir, contract)
    const profile = this.profile(ir, contract)
    const inputs = ir.actions.map(
      (action): PolicyInput => ({
        user_intent: [contract.initial, ...contract.clarifications].map((m) => m.text).join("\n"),
        authority: authority(contract),
        contract,
        ir,
        profile,
        trusted_context: this.context,
        action: {
          ...action,
          intent_provenance:
            action.targets.length && action.targets.every((t) => authorize(contract, action.operation, t))
              ? "user_explicit"
              : "agent_invented",
        },
        history: this.history.get(session)?.slice(-10),
      }),
    )
    this.event("proposed", session, ir.call_id, {
      tool: call.tool,
      normalized: ir.actions,
      fingerprint: ir.fingerprint,
      contract_version: contract.version,
      profile_hash: digest(profile),
      operation_count: ir.actions.length,
    })
    const evaluated = this.options.observe
      ? {
          result: {
            decision: "allow" as const,
            decided_by: "level0" as const,
            reason: "observation only",
            rule: null,
            safe_alternatives: [],
            level0: { verdict: "CONTINUE" as const, rule: null, reason: null },
            level1: null,
            level2: null,
            latency_ms: 0,
          },
          results: [] as CascadeResult[],
        }
      : await evaluateCall(inputs, this.config, this.options.client)
    const result: CascadeResult = evaluated.result
    result.missing_facts ??= [...new Set(inputs.flatMap(constraints))]
    result.reason_code ??= result.rule ?? "policy_uncertain"
    result.failure ??= result.level1?.failure === "malformed" ? "invalid_response" : (result.level1?.failure ?? null)
    inputs.forEach((input, index) =>
      this.options.onDecision?.({
        tool: call.tool,
        sessionID: session,
        input,
        result: evaluated.results[index] ?? result,
      }),
    )
    this.event("policy_decided", session, ir.call_id, {
      operation_results: evaluated.results,
      policy_decision: this.options.observe ? null : result.decision,
      decision: this.options.observe ? null : result,
      contract_version: contract.version,
    })
    const prepared: Prepared = { session, call, ir, contract, profile, result, inputs }
    if (result.decision !== "allow") this.remember(prepared, false, null, null)
    if (result.decision === "deny" && !this.options.observe) {
      const key = `${session}:${ir.fingerprint}`
      const count =
        Math.max(
          this.denials.get(key) ?? 0,
          contract.pending.some((p) => p.fingerprint === ir.fingerprint && p.missing_facts.includes("repeated_denial"))
            ? 2
            : 0,
        ) + 1
      this.denials.set(key, count)
      if (count >= 3) {
        result.reason += " (repeated equivalent denial; escalating to the developer)"
        result.missing_facts = ["repeated_denial"]
        const request = pending(contract, ir, result.missing_facts, [])
        request.question =
          "Три эквивалентных действия отклонены. Уточните задачу или выберите предложенный безопасный путь. Запрещённое действие остаётся запрещённым."
        contract.pending = [request]
        this.store.write(contract, contract.version)
        prepared.pending = request
      }
    }
    if (result.decision === "ask" && !this.options.observe) {
      const candidates: Grant[] = contract.uncertainties?.length
        ? []
        : ir.actions.flatMap((action) =>
            (action.resources ?? [])
              .filter(
                (r) =>
                  (r.kind === "file" || r.kind === "directory") &&
                  inside(contract.workspace, r.key) &&
                  !authorize(contract, action.operation, r.key) &&
                  (!contract.parent_id || authorize(this.contract(contract.parent_id), action.operation, r.key)),
              )
              .filter(
                () =>
                  ["code.modify", "test.run", "filesystem.delete"].includes(action.operation) &&
                  !action.uncertainty?.length,
              )
              .map((r) => ({
                operation: action.operation,
                resource: r,
                source: contract.initial.id,
                evidence: "action-specific user confirmation",
                confirmed: "user" as const,
              })),
          )
      const request = pending(contract, ir, result.missing_facts, candidates)
      if (contract.uncertainties?.length)
        request.question = `Уточните ограничение для ${ir.tool}: ${contract.uncertainties.map((m) => m.text).join("; ")}. Назовите операцию и путь, например «Не меняй tests/» или «Исправь src/parser.py».`
      contract.pending = [request]
      this.store.write(contract, contract.version)
      prepared.pending = request
    }
    return prepared
  }
  answer(prepared: Prepared, approved: boolean, actor: "user" | "scripted" = "user"): void {
    if (!prepared.pending) throw new Error("missing_pending_approval")
    const current = this.store.read(prepared.session)
    if (!current) throw new Error("missing_contract")
    const next = reply(current, prepared.pending.id, prepared.ir.fingerprint, prepared.contract.version, approved)
    this.store.write(next, current.version)
    this.event("approval_replied", prepared.session, prepared.ir.call_id, {
      request_id: prepared.pending.id,
      actor,
      approved,
      contract_version: next.version,
    })
  }
  verify(prepared: Prepared, initial = true): void {
    const current = this.contract(prepared.session)
    if (!current.active || current.version !== prepared.contract.version)
      throw new Error("contract_changed_before_execution")
    const fresh = normalizeCall(prepared.call, this.context)
    if (fresh.fingerprint !== prepared.ir.fingerprint) throw new Error("action_changed_before_execution")
    const before = prepared.ir.actions.flatMap((a) => a.resources ?? []).map((r) => [r.key, r.identity])
    const after = fresh.actions.flatMap((a) => a.resources ?? []).map((r) => [r.key, r.identity])
    if (initial && digest(before) !== digest(after)) throw new Error("resource_changed_before_execution")
    const profile = this.profile(fresh, current)
    if (digest(profile) !== digest(prepared.profile)) throw new Error("execution_profile_changed")
    if (
      !this.options.observe &&
      prepared.inputs.some(
        (input) =>
          constraints({ ...input, contract: current, profile }).length ||
          hardDeny({ ...input, contract: current }).verdict === "DENY",
      )
    )
      throw new Error("execution_constraints_changed")
  }
  finished(prepared: Prepared, executed: boolean | null, exit: number | null, error: string | null): void {
    this.remember(prepared, executed, exit, error)
    this.event("tool_finished", prepared.session, prepared.ir.call_id, { executed, exit_code: exit, error })
  }
  remember(prepared: Prepared, executed: boolean | null, exit: number | null, error: string | null): void {
    const history = this.history.get(prepared.session) ?? []
    history.push({
      call_id: prepared.ir.call_id,
      actions: prepared.ir.actions,
      decision: this.options.observe ? null : prepared.result.decision,
      executed,
      exit_code: exit,
      error:
        error == null
          ? null
          : /PermissionDenied|permission.*reject/i.test(error)
            ? "native_permission_rejected"
            : /interrupt|cancel/i.test(error)
              ? "cancelled"
              : "tool_error",
    })
    this.history.set(prepared.session, history.slice(-10))
  }
}

const symbol = Symbol.for("kilocode.autoguard.controllers.v2")
const registry = globalThis as typeof globalThis & { [symbol]?: Map<string, Controller> }
const controllers = (registry[symbol] ??= new Map<string, Controller>())
const adapter = Symbol.for("kilocode.autoguard.adapter.v2")
export function installAdapter() {
  Object.assign(globalThis, { [adapter]: true })
}
export function supported() {
  return Reflect.get(globalThis, adapter) === true
}
export function register(directory: string, controller: Controller): () => void {
  const key = canonical(directory, process.cwd())
  controllers.set(key, controller)
  return () => {
    if (controllers.get(key) === controller) controllers.delete(key)
  }
}
export function registered(directory: string): Controller | undefined {
  return controllers.get(canonical(directory, process.cwd()))
}
export function stateRoot(): string {
  return process.env.AUTOGUARD_STATE_DIR ?? path.join(os.homedir(), ".local", "state", "kilo-autoguard")
}

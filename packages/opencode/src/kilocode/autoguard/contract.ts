import { z } from "zod"
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  lstatSync,
  openSync,
  closeSync,
  fsyncSync,
  unlinkSync,
} from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { authority, catalog, canonicalCatalog, grammar } from "./authority"
import { canonical, covers, digest, inside } from "./resources"
import { endpoint, type Level1Config } from "./level1"
import { strictJSON } from "./json"
import type { ActionIR, ContractMessage, Grant, PendingApproval, TaskContract, TrustedContext } from "./types"

const Resource = z
  .object({
    raw: z.string(),
    key: z.string(),
    kind: z.enum(["file", "directory", "url", "reference"]),
    identity: z.string().optional(),
    exists: z.boolean().optional(),
    symlink: z.boolean().optional(),
  })
  .strict()
const GrantSchema = z
  .object({
    operation: z.string(),
    resource: Resource,
    source: z.string(),
    evidence: z.string(),
    confirmed: z.enum(["grammar", "user"]),
  })
  .strict()
const Message = z.object({ id: z.string(), text: z.string() }).strict()
const Pending = z
  .object({
    id: z.string(),
    version: z.number().int(),
    fingerprint: z.string(),
    question: z.string(),
    candidates: z.array(GrantSchema),
    missing_facts: z.array(z.string()),
  })
  .strict()
const Contract = z
  .object({
    schema_version: z.literal(1),
    session_id: z.string(),
    workspace: z.string(),
    version: z.number().int().positive(),
    expires: z.literal("session"),
    active: z.boolean(),
    initial: Message,
    clarifications: z.array(Message),
    grants: z.array(GrantSchema),
    prohibitions: z.array(GrantSchema),
    catalog: z
      .object({ source: z.array(z.string()), verification: z.array(z.string()), generated_output: z.array(z.string()) })
      .strict(),
    pending: z.array(Pending),
    parent_id: z.string().optional(),
    parent_version: z.number().int().optional(),
    proposals: z.array(GrantSchema),
    configuration_hash: z.string().optional(),
    uncertainties: z.array(Message).optional(),
    extractor_failure: z.string().nullable(),
  })
  .strict()

export const EXTRACTOR_PROMPT = `Propose a task contract from DIRECT USER MESSAGES only. Return JSON {"proposals":[{"operation":"code.modify|filesystem.delete|test.run","target":"literal path","source":"message id","evidence":"exact supporting quote"}]}. Preserve negation. A mention is not permission. Tests used for verification are not writable. Resolve generated output only through the supplied trusted catalog. Do not invent paths or authority. Your proposals require deterministic validation or user confirmation. No reasoning or markdown.`
const Proposals = z
  .object({
    proposals: z
      .array(
        z
          .object({
            operation: z.enum(["code.modify", "filesystem.delete", "test.run"]),
            target: z.string().min(1),
            source: z.string(),
            evidence: z.string().min(1),
          })
          .strict(),
      )
      .max(32),
  })
  .strict()

export async function propose(
  message: ContractMessage,
  ctx: TrustedContext,
  config: Level1Config,
): Promise<{ grants: Grant[]; failure: string | null }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  try {
    const response = await fetch(endpoint(config.baseUrl), {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        ...config.extraBody,
        model: config.model,
        temperature: 0,
        max_tokens: 1024,
        stream: false,
        messages: [
          { role: "system", content: EXTRACTOR_PROMPT },
          { role: "user", content: JSON.stringify({ message, catalog: catalog(ctx), workspace: ctx.workspace_root }) },
        ],
      }),
    })
    if (!response.ok) return { grants: [], failure: "transport" }
    const envelope = z
      .object({
        choices: z
          .array(z.object({ message: z.object({ content: z.string() }), finish_reason: z.string().nullish() }))
          .min(1),
      })
      .safeParse(await response.json())
    if (!envelope.success || envelope.data.choices[0].finish_reason === "length")
      return { grants: [], failure: "invalid_response" }
    const parsed = Proposals.safeParse(strictJSON(envelope.data.choices[0].message.content))
    if (!parsed.success) return { grants: [], failure: "invalid_response" }
    const proposals: Grant[] = []
    for (const item of parsed.data.proposals) {
      if (item.source !== message.id || !message.text.includes(item.evidence))
        return { grants: [], failure: "invalid_evidence" }
      const key = canonical(item.target, ctx.cwd)
      if (!inside(canonical(ctx.workspace_root, ctx.cwd), key)) continue
      proposals.push({
        operation: item.operation,
        resource: { raw: item.target, key, kind: item.target.endsWith("/") ? "directory" : "file" },
        source: message.id,
        evidence: item.evidence,
        confirmed: "grammar",
      })
    }
    // These are still only proposals. update() never activates an unverified proposal.
    return { grants: proposals, failure: null }
  } catch {
    return { grants: [], failure: controller.signal.aborted ? "timeout" : "invalid_response" }
  } finally {
    clearTimeout(timer)
  }
}

export function update(
  previous: TaskContract | undefined,
  session: string,
  message: ContractMessage,
  ctx: TrustedContext,
  clarified: string[] = [],
): TaskContract {
  if (previous && [previous.initial, ...previous.clarifications].some((m) => m.id === message.id)) return previous
  const parsed = grammar(message, ctx)
  const resolved = !parsed.ambiguous && (parsed.grants.length > 0 || parsed.prohibitions.length > 0)
  const uncertainties = [
    ...(previous?.uncertainties ?? []).filter((m) => !resolved || !clarified.includes(m.id)),
    ...(parsed.ambiguous ? [message] : []),
  ]
  const catalog = canonicalCatalog(ctx)
  // A host role change or an unparsed restriction invalidates earlier grants.
  const retained = previous && digest(previous.catalog) === digest(catalog) ? previous.grants : []
  const grants = parsed.ambiguous ? [] : [...retained, ...parsed.grants]
  const prohibitions = [...(previous?.prohibitions ?? []), ...parsed.prohibitions]
  return {
    schema_version: 1,
    session_id: session,
    workspace: canonical(ctx.workspace_root, ctx.cwd),
    version: (previous?.version ?? 0) + 1,
    expires: "session",
    active: previous?.active ?? true,
    initial: previous?.initial ?? message,
    clarifications: previous ? [...previous.clarifications, message] : [],
    grants: grants.filter(
      (g) => !prohibitions.some((p) => p.operation === g.operation && covers(p.resource, g.resource.key)),
    ),
    prohibitions,
    uncertainties,
    catalog,
    pending: [],
    proposals: [],
    extractor_failure: parsed.ambiguous ? "ambiguous_grammar" : null,
    ...(previous?.configuration_hash ? { configuration_hash: previous.configuration_hash } : {}),
    ...(previous?.parent_id ? { parent_id: previous.parent_id } : {}),
  }
}

export function inherited(parent: TaskContract, child: TaskContract | undefined, session: string): TaskContract {
  const narrowed = child?.grants.filter((g) =>
    parent.grants.some((p) => p.operation === g.operation && covers(p.resource, g.resource.key)),
  )
  return {
    ...parent,
    session_id: session,
    parent_id: parent.session_id,
    parent_version: parent.version,
    grants: narrowed ?? parent.grants,
    pending: [],
    proposals: [],
    prohibitions: [...parent.prohibitions, ...(child?.prohibitions ?? [])],
    version: Math.max(parent.version, child?.version ?? 0) + 1,
  }
}

export function authorize(contract: TaskContract, operation: string, target: string): boolean {
  return (
    contract.active &&
    !contract.uncertainties?.length &&
    !contract.prohibitions.some(
      (g) => (g.operation === operation || g.operation === "*") && covers(g.resource, target),
    ) &&
    contract.grants.some(
      (g) =>
        g.operation === operation &&
        covers(g.resource, target) &&
        (!["code.modify", "config.modify"].includes(operation) ||
          contract.catalog.verification.every(
            (p) =>
              !inside(canonical(p, contract.workspace), target) ||
              inside(canonical(p, contract.workspace), g.resource.key),
          )),
    )
  )
}

export function pending(contract: TaskContract, ir: ActionIR, missing: string[], candidates: Grant[]): PendingApproval {
  const existing = contract.pending.find((x) => x.version === contract.version && x.fingerprint === ir.fingerprint)
  if (existing) return existing
  return {
    id: randomUUID(),
    version: contract.version,
    fingerprint: ir.fingerprint,
    missing_facts: missing,
    candidates,
    question: candidates.length
      ? `Разрешить ${candidates.map((g) => `${g.operation}: ${g.resource.raw}`).join(", ")} для этой задачи?`
      : `Уточните действие ${ir.tool}: ${missing.join(", ")}. Используйте инструмент с явной целью.`,
  }
}

export function reply(
  contract: TaskContract,
  id: string,
  fingerprint: string,
  version: number,
  approved: boolean,
): TaskContract {
  const request = contract.pending.find((p) => p.id === id && p.version === version && p.fingerprint === fingerprint)
  if (!request || version !== contract.version || !contract.active) throw new Error("stale_approval")
  const grants = approved
    ? request.candidates
        .filter(
          (g) => !contract.prohibitions.some((p) => p.operation === g.operation && covers(p.resource, g.resource.key)),
        )
        .map((g) => ({ ...g, source: `approval:${id}`, confirmed: "user" as const }))
    : []
  return { ...contract, version: contract.version + 1, grants: [...contract.grants, ...grants], pending: [] }
}

export class ContractStore {
  readonly root: string
  constructor(
    root: string,
    readonly workspace: string,
  ) {
    this.root = canonical(root, process.cwd())
    if (inside(canonical(workspace, process.cwd()), this.root)) throw new Error("contract_store_inside_workspace")
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
  }
  private file(session: string): string {
    return path.join(this.root, `${digest([this.workspace, session])}.json`)
  }
  read(session: string): TaskContract | undefined {
    const file = this.file(session)
    if (!existsSync(file)) return
    if (lstatSync(file).isSymbolicLink()) throw new Error("contract_store_symlink")
    const value = Contract.parse(strictJSON(readFileSync(file, "utf8")))
    if (value.workspace !== canonical(this.workspace, process.cwd()) || value.session_id !== session)
      throw new Error("contract_identity_mismatch")
    return value
  }
  write(contract: TaskContract, expected?: number): void {
    const file = this.file(contract.session_id)
    const lock = `${file}.lock`
    if (existsSync(lock)) {
      const owner = Number(readFileSync(lock, "utf8"))
      if (!Number.isInteger(owner) || owner <= 0) throw new Error("contract_store_locked")
      try {
        process.kill(owner, 0)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
        unlinkSync(lock)
      }
    }
    const handle = openSync(lock, "wx", 0o600)
    writeFileSync(handle, String(process.pid))
    try {
      if (expected != null && this.read(contract.session_id)?.version !== expected)
        throw new Error("contract_version_conflict")
      const value = Contract.parse(contract)
      const temporary = `${file}.${randomUUID()}.tmp`
      const fd = openSync(temporary, "wx", 0o600)
      try {
        writeFileSync(fd, JSON.stringify(value))
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      renameSync(temporary, file)
    } finally {
      closeSync(handle)
      unlinkSync(lock)
    }
  }

  authority(session: string) {
    const contract = this.read(session)
    return authority(contract ?? { grants: [], prohibitions: [], active: false })
  }
}

import z from "zod"

export const FieldSpec = z.object({
  name: z.string(),
  type: z.string(),
  required: z.boolean().default(true),
  description: z.string().default(""),
})
export type FieldSpec = z.infer<typeof FieldSpec>

export const APIContract = z.object({
  id: z.string(),
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]),
  path: z.string(),
  description: z.string().default(""),
  requestBody: z.array(FieldSpec).nullable().default(null),
  responseBody: z.array(FieldSpec),
  responseExample: z.string().default(""),
  producerTaskId: z.string(),
  consumerTaskIds: z.array(z.string()),
})
export type APIContract = z.infer<typeof APIContract>

export const TypeContract = z.object({
  name: z.string(),
  description: z.string().default(""),
  fieldSpecs: z.array(FieldSpec),
  usedByTasks: z.array(z.string()),
})
export type TypeContract = z.infer<typeof TypeContract>

export const IntegrationHint = z.object({
  producerTaskId: z.string(),
  consumerTaskIds: z.array(z.string()),
  interfaceType: z.enum(["api_endpoint", "shared_type", "event", "file_import"]),
  description: z.string(),
  endpointHints: z.array(z.string()).default([]),
})
export type IntegrationHint = z.infer<typeof IntegrationHint>

export const ContractSet = z.object({
  apiContracts: z.array(APIContract).default([]),
  typeContracts: z.array(TypeContract).default([]),
  integrationHints: z.array(IntegrationHint).default([]),
})
export type ContractSet = z.infer<typeof ContractSet>

export type TaskContracts = {
  producing: APIContract[]
  consuming: APIContract[]
  types: TypeContract[]
}

export function contractsForTask(set: ContractSet, taskId: string): TaskContracts {
  return {
    producing: set.apiContracts.filter((c) => c.producerTaskId === taskId),
    consuming: set.apiContracts.filter((c) => c.consumerTaskIds.includes(taskId)),
    types: set.typeContracts.filter((t) => t.usedByTasks.includes(taskId)),
  }
}

export function hasContracts(set: ContractSet): boolean {
  return set.apiContracts.length > 0 || set.typeContracts.length > 0
}

export function validateTaskRefs(set: ContractSet, validTaskIds: Set<string>): string[] {
  const errors: string[] = []
  for (const api of set.apiContracts) {
    if (!validTaskIds.has(api.producerTaskId)) {
      errors.push(`API contract ${api.id}: producer task "${api.producerTaskId}" not found`)
    }
    for (const cid of api.consumerTaskIds) {
      if (!validTaskIds.has(cid)) {
        errors.push(`API contract ${api.id}: consumer task "${cid}" not found`)
      }
    }
  }
  for (const tc of set.typeContracts) {
    for (const tid of tc.usedByTasks) {
      if (!validTaskIds.has(tid)) {
        errors.push(`Type contract "${tc.name}": task "${tid}" not found`)
      }
    }
  }
  return errors
}

function formatField(f: FieldSpec): string {
  return `  ${f.name}: ${f.type}${f.required ? "" : "?"}${f.description ? ` — ${f.description}` : ""}`
}

export function formatContractsForAgent(tc: TaskContracts): string {
  const lines: string[] = []
  if (tc.producing.length > 0) {
    lines.push("## Contracts You MUST PRODUCE\n")
    for (const api of tc.producing) {
      lines.push(`### ${api.method} ${api.path}`)
      lines.push(api.description)
      if (api.requestBody) {
        lines.push("Request body:")
        for (const f of api.requestBody) lines.push(formatField(f))
      }
      lines.push("Response body:")
      for (const f of api.responseBody) lines.push(formatField(f))
      if (api.responseExample) lines.push(`Example: ${api.responseExample}`)
      lines.push("")
    }
  }
  if (tc.consuming.length > 0) {
    lines.push("## Contracts You MUST CONSUME\n")
    for (const api of tc.consuming) {
      lines.push(`### ${api.method} ${api.path}`)
      lines.push(api.description)
      lines.push("Expected response:")
      for (const f of api.responseBody) lines.push(formatField(f))
      lines.push("")
    }
  }
  if (tc.types.length > 0) {
    lines.push("## Shared Types\n")
    for (const t of tc.types) {
      lines.push(`### ${t.name}`)
      lines.push(t.description)
      for (const f of t.fieldSpecs) lines.push(formatField(f))
      lines.push("")
    }
  }
  return lines.join("\n")
}

export function formatContractsForReviewer(tc: TaskContracts): string {
  const lines: string[] = ["## Contract Compliance Check\n"]
  lines.push("Verify the implementation matches these exact specifications.")
  lines.push("If any field names, types, or response shapes don't match the contract, FAIL the review.\n")
  if (tc.producing.length > 0) {
    lines.push("### APIs this task MUST produce:")
    for (const api of tc.producing) {
      lines.push(`- ${api.method} ${api.path}`)
      lines.push("  Response fields:")
      for (const f of api.responseBody) lines.push(`    ${formatField(f)}`)
    }
    lines.push("")
  }
  if (tc.consuming.length > 0) {
    lines.push("### APIs this task MUST consume:")
    for (const api of tc.consuming) {
      lines.push(`- ${api.method} ${api.path}`)
    }
    lines.push("")
  }
  return lines.join("\n")
}

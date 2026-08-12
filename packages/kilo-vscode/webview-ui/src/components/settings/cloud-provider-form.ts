import type { UiI18nParams } from "@kilocode/kilo-ui/context"
import { BEDROCK_ID, VERTEX_ID } from "../../../../src/shared/cloud-provider"

export type CloudMode = "apiKey" | "accessKeys" | "profile"

type CloudFields = {
  region: string
  profile: string
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
  apiKey: string
  endpoint: string
  project: string
  location: string
  credentials: string
}

export type CloudError = { ok: false; field?: string; message: string }
type CloudResult = { ok: true; metadata: Record<string, string>; apiKey: string }

type Translate = (key: string, params?: UiI18nParams) => string

function text(value: string) {
  return value.trim()
}

function fail(field: keyof CloudFields | undefined, message: string): CloudError {
  return { ok: false, field, message }
}

function required(fields: CloudFields, field: keyof CloudFields, label: string, t: Translate) {
  const value = text(fields[field])
  if (value) return value
  return fail(field, t("provider.connect.prompt.required", { field: t(label) }))
}

function parseVertex(fields: CloudFields, t: Translate): CloudError | { project: string; credentials?: string } {
  const blob = text(fields.credentials)
  if (!blob) {
    const project = required(fields, "project", "provider.connect.vertex.project.label", t)
    if (typeof project !== "string") return project
    return { project }
  }
  try {
    const parsed = JSON.parse(blob) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return fail("credentials", t("provider.connect.vertex.credentials.invalid"))
    }
    const project =
      text(fields.project) ||
      (typeof (parsed as { project_id?: unknown }).project_id === "string"
        ? (parsed as { project_id: string }).project_id.trim()
        : "")
    if (!project) {
      return fail("project", t("provider.connect.prompt.required", { field: t("provider.connect.vertex.project.label") }))
    }
    return { project, credentials: JSON.stringify(parsed) }
  } catch {
    return fail("credentials", t("provider.connect.vertex.credentials.invalid"))
  }
}

function parseBedrock(fields: CloudFields, mode: CloudMode, t: Translate): CloudError | CloudResult {
  const region = required(fields, "region", "provider.connect.bedrock.region.label", t)
  if (typeof region !== "string") return region
  const metadata: Record<string, string> = { mode, region }
  const endpoint = text(fields.endpoint)
  if (endpoint) metadata.endpoint = endpoint
  if (mode === "apiKey") {
    if (!text(fields.apiKey)) return fail("apiKey", t("provider.connect.apiKey.required"))
    return { ok: true, metadata, apiKey: text(fields.apiKey) }
  }
  if (mode === "accessKeys") {
    const access = required(fields, "accessKeyId", "provider.connect.bedrock.accessKeyId.label", t)
    const secret = required(fields, "secretAccessKey", "provider.connect.bedrock.secretAccessKey.label", t)
    if (typeof access !== "string") return access
    if (typeof secret !== "string") return secret
    metadata.accessKeyId = access
    metadata.secretAccessKey = secret
    const session = text(fields.sessionToken)
    if (session) metadata.sessionToken = session
    return { ok: true, metadata, apiKey: "" }
  }
  const profile = required(fields, "profile", "provider.connect.bedrock.profile.label", t)
  if (typeof profile !== "string") return profile
  metadata.profile = profile
  return { ok: true, metadata, apiKey: "" }
}

export function buildCloudConnect(
  id: typeof BEDROCK_ID | typeof VERTEX_ID,
  fields: CloudFields,
  mode: CloudMode,
  t: Translate,
): CloudError | CloudResult {
  if (id === BEDROCK_ID) return parseBedrock(fields, mode, t)
  const parsed = parseVertex(fields, t)
  if (parsed.ok === false) return parsed
  const location = required(fields, "location", "provider.connect.vertex.location.label", t)
  if (typeof location !== "string") return location
  const metadata: Record<string, string> = { project: parsed.project, location }
  if (parsed.credentials) metadata.credentials = parsed.credentials
  return { ok: true, metadata, apiKey: "" }
}

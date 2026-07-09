import { request } from "@umijs/max"
import { TOKEN_KEY } from "@/constants"

export type Me = {
  id: string
  tenant_id: string
  roles: string[]
}

export type Tenant = {
  id: string
  name: string
  status: string
  createdAt?: string
  licenseExpiresAt?: string
  licenseDaysLeft?: number
  licenseExpiringSoon?: boolean
}

export type LicenseStatus = {
  activated: boolean
  expiresAt?: string
  daysLeft: number
  expiringSoon: boolean
}

export type Role = {
  name: string
  kind: string
  level: number
}

export type User = {
  id: string
  email: string
  displayName?: string
  status: string
  roles: string[]
  ssoBound?: boolean
}

export type UserDetail = User & {
  oidcSub?: string
  createdAt?: string
}

export type ModelConfig = {
  provider: string
  apiBase: string
  defaultModel: string
  smallModel?: string
  fallbackProvider?: string
  apiKeyEnv?: string
}

export type HealthItem = {
  name: string
  url?: string
  status: string
  code?: number
}

export type AuditRow = {
  id: number
  kind: string
  summary: string
  actorId?: string
  createdAt: string
}

export type UsageDetail = {
  days: number
  daily: { date: string; count: number }[]
  clients: { client: string; machineId: string; count: number; lastAt: string }[]
}

export type UsageUserRow = {
  rank: number
  name: string
  email: string
  ide: string
  activeDays: number
  trend: string
  completionSuggested: number
  completionAccepted: number
  completionAcceptedLines: number
  agentTriggered: number
  agentFileEdited: number
  agentFileEditAccepted: number
  completionAcceptedChars: number
  inlineChars: number
  agentAcceptedChars: number
  tokens: number
  completionAcceptRate: number
  agentEditAcceptRate: number
}

export type UsageIDERow = {
  ide: string
  completionSuggested: number
  completionAccepted: number
  agentTriggered: number
  agentFileEdited: number
  tokens: number
}

export type UsageDailyRow = {
  date: string
  name: string
  email: string
  ide: string
  completionSuggested: number
  completionAccepted: number
  tokens: number
}

export type UsageInactiveRow = {
  name: string
  email: string
}

export type UsageAnalyticsReport = {
  from: string
  to: string
  userSummary: UsageUserRow[]
  ideSummary: UsageIDERow[]
  dailyDetail: UsageDailyRow[]
  inactiveUsers: UsageInactiveRow[]
}

export type AssessmentConfig = {
  weightOutput: number
  weightToken: number
  weightActive: number
}

export type AssessmentRow = {
  rank: number
  name: string
  email: string
  activeDays: number
  aiAcceptedChars: number
  tokens: number
  activeParticipation: number
  outputScore: number
  tokenScore: number
  activeScore: number
  baseScore: number
  efficiencyMult: number
  compositeScore: number
  grade: string
}

export type GradeCount = {
  grade: string
  count: number
}

export type AssessmentReport = {
  from: string
  to: string
  config: AssessmentConfig
  rows: AssessmentRow[]
  gradeSummary: GradeCount[]
}

export type License = {
  id: string
  licenseKey: string
  expiresAt: string
  status: string
  usageCount: number
  createdAt: string
  daysLeft?: number
  expiringSoon?: boolean
}

export type AuthStatus = {
  enabled: boolean
  issuer?: string
  login?: string
}

function token() {
  return localStorage.getItem(TOKEN_KEY) ?? ""
}

export function setToken(raw: string) {
  localStorage.setItem(TOKEN_KEY, raw)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export function authHeader() {
  const raw = token()
  return raw ? { Authorization: `Bearer ${raw}` } : {}
}

export async function authStatus() {
  return request<AuthStatus>("/api/v1/auth/status")
}

export async function devLogin(email: string) {
  const data = await request<{ accessToken: string }>("/api/v1/auth/dev-token", {
    method: "POST",
    data: { email },
    skipErrorHandler: true,
  })
  setToken(data.accessToken)
  return data
}

export async function fetchMe() {
  return request<Me>("/api/v1/auth/me", { headers: authHeader() })
}

export async function listTenants() {
  const data = await request<{ items: Tenant[] }>("/api/v1/tenants", { headers: authHeader() })
  return data.items ?? []
}

export async function createTenant(name: string) {
  return request<{ id: string; status: string }>("/api/v1/tenants", {
    method: "POST",
    headers: authHeader(),
    data: { name },
  })
}

export async function patchTenant(id: string, body: { name?: string; status?: string }) {
  return request<{ status: string }>(`/api/v1/tenants/${id}`, {
    method: "PATCH",
    headers: authHeader(),
    data: body,
  })
}

export type OfflineLicenseFile = {
  key: string
  expiresAt: string
  signature?: string
  algorithm?: string
}

const LICENSE_IMPORT_ERRORS: Record<string, string> = {
  bad_offline_json: "License 文件不是有效 JSON",
  missing_key: "缺少 key 字段",
  missing_expires: "缺少 expiresAt 字段",
  bad_expires: "expiresAt 格式无效",
  expired: "License 已过期",
  bad_signature: "签名无效",
  no_public_key: "服务端未配置验签公钥",
  key_owned_by_other_tenant: "该 License key 已绑定其他租户",
  import_failed: "导入失败",
}

export async function uploadTenantLicense(tenantId: string, file: OfflineLicenseFile) {
  return request<{ id: string; status: string }>(`/api/v1/tenants/${tenantId}/licenses`, {
    method: "POST",
    headers: authHeader(),
    data: file,
    skipErrorHandler: true,
  })
}

export function licenseImportError(code: string) {
  return LICENSE_IMPORT_ERRORS[code] ?? code
}

export async function listRoles() {
  const data = await request<{ items: Role[] }>("/api/v1/roles", { headers: authHeader() })
  return data.items ?? []
}

export async function listUsers() {
  const data = await request<{ items: User[] }>("/api/v1/users", { headers: authHeader() })
  return data.items ?? []
}

export async function getUser(id: string) {
  return request<UserDetail>(`/api/v1/users/${id}`, { headers: authHeader() })
}

export async function assignRole(userId: string, role: string) {
  return request<{ status: string }>(`/api/v1/users/${userId}/roles`, {
    method: "POST",
    headers: authHeader(),
    data: { role },
    skipErrorHandler: true,
  })
}

export async function unassignRole(userId: string, role: string) {
  return request<{ status: string }>(`/api/v1/users/${userId}/roles`, {
    method: "DELETE",
    headers: authHeader(),
    data: { role },
    skipErrorHandler: true,
  })
}

export async function usageSummary() {
  return request<{ licenseUsage: number; users: number }>("/api/v1/usage/summary", {
    headers: authHeader(),
  })
}

export async function usageDetail(days = 7) {
  return request<UsageDetail>("/api/v1/usage/detail", {
    headers: authHeader(),
    params: { days },
  })
}

export async function fetchUsageAnalyticsReport(from: string, to: string) {
  return request<UsageAnalyticsReport>("/api/v1/usage/analytics/report", {
    headers: authHeader(),
    params: { from, to },
  })
}

export async function exportUsageAnalytics(from: string, to: string) {
  const res = await fetch(`/api/v1/usage/analytics/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
    headers: authHeader() as HeadersInit,
  })
  if (!res.ok) throw new Error(`export failed: ${res.status}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `analysis_report-${from}-${to}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

export async function fetchAssessmentConfig() {
  return request<AssessmentConfig>("/api/v1/usage/assessment/config", {
    headers: authHeader(),
  })
}

export async function fetchAssessmentReport(from: string, to: string) {
  return request<AssessmentReport>("/api/v1/usage/assessment/report", {
    headers: authHeader(),
    params: { from, to },
  })
}

export async function exportAssessmentReport(from: string, to: string) {
  const res = await fetch(
    `/api/v1/usage/assessment/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { headers: authHeader() as HeadersInit },
  )
  if (!res.ok) throw new Error(`export failed: ${res.status}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `assessment_report-${from}-${to}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

export async function listLicenses() {
  const data = await request<{ items: License[] }>("/api/v1/licenses", { headers: authHeader() })
  return data.items ?? []
}

export async function fetchLicenseStatus() {
  return request<LicenseStatus>("/api/v1/licenses/status", { headers: authHeader() })
}

export async function getModelConfig() {
  return request<ModelConfig>("/api/v1/model-config", { headers: authHeader() })
}

export async function saveModelConfig(cfg: ModelConfig) {
  return request<{ status: string }>("/api/v1/model-config", {
    method: "PUT",
    headers: authHeader(),
    data: cfg,
  })
}

export async function applyModelConfig() {
  return request<Record<string, unknown>>("/api/v1/model-config/apply", {
    method: "POST",
    headers: authHeader(),
    data: {},
  })
}

export async function monitorHealth() {
  const data = await request<{ items: HealthItem[]; at: string }>("/api/v1/monitor/health", {
    headers: authHeader(),
  })
  return data
}

export async function listAudit(opts?: {
  kind?: string
  from?: string
  to?: string
  page?: number
  pageSize?: number
}) {
  const data = await request<{ items: AuditRow[]; total: number }>("/api/v1/audit/logs", {
    headers: authHeader(),
    params: opts,
  })
  return { items: data.items ?? [], total: data.total ?? 0 }
}

export function oidcLoginUrl() {
  return "/api/v1/auth/login"
}

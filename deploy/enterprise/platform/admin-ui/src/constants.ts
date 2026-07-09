export const TOKEN_KEY = "ent_admin_token"

export const ROLE_OPTIONS = [
  { label: "查看者 (viewer)", value: "viewer" },
  { label: "开发者 (developer)", value: "developer" },
  { label: "租户管理员 (tenant_admin)", value: "tenant_admin" },
  { label: "系统管理员 (sys_admin)", value: "sys_admin" },
  { label: "安全管理员 (security_admin)", value: "security_admin" },
  { label: "审计管理员 (audit_admin)", value: "audit_admin" },
]

export const PROVIDERS = [
  { label: "DeepSeek", value: "deepseek" },
  { label: "Qwen", value: "qwen" },
  { label: "GLM", value: "glm" },
  { label: "Minimax", value: "minimax" },
]

export default function access(initialState: { roles?: string[] }) {
  const roles = initialState?.roles ?? []
  const has = (...names: string[]) => names.some((name) => roles.includes(name))

  const canAdminPanel = has("sys_admin", "security_admin", "audit_admin", "tenant_admin")

  return {
    canAdminPanel,
    canTenants: has("sys_admin", "tenant_admin"),
    canTenantsCreate: has("sys_admin"),
    canUsers: has("sys_admin", "security_admin", "tenant_admin"),
    canUsage: has("sys_admin", "tenant_admin", "audit_admin"),
    canModel: has("sys_admin", "tenant_admin", "security_admin"),
    canModelWrite: has("sys_admin", "tenant_admin"),
    canMonitor: has("sys_admin", "security_admin", "audit_admin", "tenant_admin"),
    canAudit: has("sys_admin", "audit_admin", "security_admin"),
    canIndex: canAdminPanel,
    canSecurity: canAdminPanel,
  }
}

export const ADMIN_ROLES = ["sys_admin", "security_admin", "audit_admin", "tenant_admin"] as const

export function canEnterAdmin(roles: string[]) {
  return roles.some((role) => (ADMIN_ROLES as readonly string[]).includes(role))
}

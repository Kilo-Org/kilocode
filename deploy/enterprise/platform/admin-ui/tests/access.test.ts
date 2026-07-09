import assert from "node:assert/strict"
import { test } from "node:test"
import access, { ADMIN_ROLES, canEnterAdmin } from "../src/access"

test("canEnterAdmin", () => {
  assert.equal(canEnterAdmin(["tenant_admin"]), true)
  assert.equal(canEnterAdmin(["developer"]), false)
  assert.equal(canEnterAdmin([]), false)
})

test("access matrix", () => {
  const a = access({ roles: ["audit_admin"] })
  assert.equal(a.canUsage, true)
  assert.equal(a.canTenants, false)
  assert.equal(a.canModelWrite, false)
})

test("sys_admin full write", () => {
  const a = access({ roles: ["sys_admin"] })
  assert.equal(a.canTenantsCreate, true)
  assert.equal(a.canModelWrite, true)
  assert.equal(a.canAudit, true)
})

test("admin roles constant", () => {
  assert.equal(ADMIN_ROLES.length, 4)
})

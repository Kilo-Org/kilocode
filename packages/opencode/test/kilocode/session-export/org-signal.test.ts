import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { getActiveOrg, resetOrgSource, setOrgSource } from "@/kilocode/session-export/eligibility"

const env = process.env.KILO_ORG_ID

describe("getActiveOrg", () => {
  beforeEach(() => {
    delete process.env.KILO_ORG_ID
    resetOrgSource()
  })

  afterEach(() => {
    if (env === undefined) delete process.env.KILO_ORG_ID
    else process.env.KILO_ORG_ID = env
    resetOrgSource()
  })

  test("returns undefined when no signals are active", async () => {
    setOrgSource(async () => undefined)
    expect(await getActiveOrg()).toBeUndefined()
  })

  test("returns env value when KILO_ORG_ID is set", async () => {
    setOrgSource(async () => "org_auth")
    process.env.KILO_ORG_ID = "org_envvar"
    expect(await getActiveOrg()).toBe("org_envvar")
  })

  test("returns auth-derived org id when env is absent", async () => {
    setOrgSource(async () => "org_auth")
    expect(await getActiveOrg()).toBe("org_auth")
  })
})

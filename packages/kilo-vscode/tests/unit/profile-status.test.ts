import { describe, expect, it } from "bun:test"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { sendProfile } from "../../src/kilo-provider/handlers/auth"
import { fixture } from "../fixtures/run"

const profile = {
  profile: { email: "user@example.test" },
  balance: null,
  kiloPass: null,
  currentOrgId: null,
}

function client(status: number, auth?: { authenticated: boolean; type?: "api" | "oauth" }) {
  const reply = (data: unknown, code: number) => ({ data, response: new Response(null, { status: code }) })
  return {
    kilo: {
      profile: async () => (status === 200 ? reply(profile, 200) : reply(undefined, status)),
      authStatus: async () => reply(auth, 200),
    },
  } as unknown as KiloClient
}

async function messages(sdk: KiloClient, read?: () => ReturnType<KiloClient["kilo"]["profile"]>) {
  const posted: unknown[] = []
  await sendProfile(sdk, (msg) => posted.push(msg), read)
  return posted
}

describe("sendProfile", () => {
  it("posts the profile", async () => {
    expect(await messages(client(200))).toEqual([{ type: "profileData", data: profile }])
  })

  it("reports a rejected OAuth login as expired", async () => {
    expect(await messages(client(401, { authenticated: true, type: "oauth" }))).toEqual([
      { type: "profileData", data: null },
      { type: "profileStatus", status: "expired" },
    ])
  })

  it("reports nobody signed in as signed out", async () => {
    expect(await messages(client(401, { authenticated: false }))).toEqual([{ type: "profileData", data: null }])
  })

  it("does not call an API key login expired", async () => {
    expect(await messages(client(401, { authenticated: true, type: "api" }))).toEqual([
      { type: "profileData", data: null },
    ])
  })

  it("keeps the shown account when the read could not complete", async () => {
    expect(await messages(client(400))).toEqual([{ type: "profileStatus", status: "unavailable" }])
  })

  it("keeps the shown account when the read throws", async () => {
    const sdk = client(200)
    expect(await messages(sdk, () => Promise.reject(new TypeError("fetch failed")))).toEqual([
      { type: "profileStatus", status: "unavailable" },
    ])
  })
})

it("renders expired, unavailable and stale profile states", () => fixture("profile-status"), 30_000)

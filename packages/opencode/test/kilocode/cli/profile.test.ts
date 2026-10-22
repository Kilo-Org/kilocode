import { describe, expect, test } from "bun:test"

import { format, handle, payload } from "../../../src/kilocode/cli/cmd/profile"

describe("profile CLI formatting", () => {
  test("formats personal balance for human output", () => {
    expect(
      format({
        name: null,
        email: "one@example.com",
        team: "Personal",
        organizationId: null,
        balance: 12.345,
      }),
    ).toBe("Email: one@example.com\nTeam: Personal\nBalance: $12.35")
  })

  test("formats profile name for human output", () => {
    expect(
      format({
        name: "User One",
        email: "one@example.com",
        team: "Team One",
        organizationId: "org-1",
        balance: 7,
      }),
    ).toBe("Name: User One\nEmail: one@example.com\nTeam: Team One\nBalance: $7.00")
  })

  test("creates JSON payload", () => {
    expect(
      payload({
        profile: {
          name: "User One",
          email: "one@example.com",
          organizations: [{ id: "org-1", name: "Team One", role: "admin" }],
        },
        balance: { balance: 3.5 },
        organizationId: "org-1",
      }),
    ).toEqual({
      name: "User One",
      email: "one@example.com",
      team: "Team One",
      organizationId: "org-1",
      balance: 3.5,
    })
  })

  test("writes human output to stdout", async () => {
    const logs: string[] = []
    const write = process.stdout.write

    process.stdout.write = ((chunk: string | Uint8Array) => {
      logs.push(String(chunk))
      return true
    }) as typeof process.stdout.write

    try {
      await handle({
        json: false,
        getAuth: async () => ({ type: "oauth", refresh: "refresh", access: "token", expires: 1 }),
        getProfile: async () => ({ email: "one@example.com", name: "User One" }),
        getBalance: async () => ({ balance: 4 }),
      })
    } finally {
      process.stdout.write = write
    }

    expect(logs.join("")).toBe("Name: User One\nEmail: one@example.com\nTeam: Personal\nBalance: $4.00\n")
  })

  test("handles profile fetch errors without throwing", async () => {
    const errors: string[] = []
    const codes: number[] = []

    await handle({
      json: false,
      error: (msg) => errors.push(msg),
      exit: (code) => codes.push(code),
      getAuth: async () => ({ type: "oauth", refresh: "refresh", access: "token", expires: 1 }),
      getProfile: async () => {
        throw new Error("Invalid token")
      },
      getBalance: async () => ({ balance: 4 }),
    })

    expect(errors).toEqual(["Invalid token"])
    expect(codes).toEqual([1])
  })
})

import { describe, expect, it } from "bun:test"
import type { OpenCodeClient } from "@opencode/client"
import { readListed } from "../src/shared/plugin-inventory"

const unavailable = { type: "rpc.unavailable", message: "RPC is unavailable: kilocode.indexing" }

// A Location that lists its plugins from the given plugin.list call on.
function location(from: number) {
  const state = { lists: 0 }
  const api = {
    plugin: {
      list: async () => {
        state.lists++
        return { data: state.lists >= from ? [{ id: "kilo" }] : [] }
      },
    },
  } as unknown as OpenCodeClient
  return { api, state }
}

describe("readListed", () => {
  it("reads again once a cold Location lists its plugins", async () => {
    const fixture = location(2)
    const reads: number[] = []
    const result = await readListed({
      api: fixture.api,
      directory: "/repo",
      active: () => true,
      read: async () => {
        reads.push(fixture.state.lists)
        if (fixture.state.lists < 2) throw unavailable
        return "status"
      },
    })

    expect(result).toBe("status")
    expect(reads).toEqual([0, 2])
  })

  it("rejects the second rpc.unavailable answer of a server without the plugin", async () => {
    const fixture = location(1)
    const result = readListed({
      api: fixture.api,
      directory: "/repo",
      active: () => true,
      read: async () => {
        throw unavailable
      },
    })

    await expect(result).rejects.toEqual(unavailable)
    expect(fixture.state.lists).toBe(1)
  })

  it("rejects other failures without waiting", async () => {
    const fixture = location(1)
    const failure = new Error("connection refused")
    const result = readListed({
      api: fixture.api,
      directory: "/repo",
      active: () => true,
      read: async () => {
        throw failure
      },
    })

    await expect(result).rejects.toBe(failure)
    expect(fixture.state.lists).toBe(0)
  })

  it("ends the wait with the first answer once it is no longer active", async () => {
    const fixture = location(Number.POSITIVE_INFINITY)
    const state = { active: true }
    const result = readListed({
      api: fixture.api,
      directory: "/repo",
      active: () => state.active,
      read: async () => {
        state.active = false
        throw unavailable
      },
    })

    await expect(result).rejects.toEqual(unavailable)
  })
})

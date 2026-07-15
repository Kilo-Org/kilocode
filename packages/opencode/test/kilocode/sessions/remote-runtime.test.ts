import { describe, expect, test } from "bun:test"
import { RemoteRuntime } from "@/kilo-sessions/remote-runtime"

describe("RemoteRuntime", () => {
  test("builds safe runtime presence without the absolute directory", () => {
    const runtime = RemoteRuntime.create({
      runtimeId: "8db3de9a-350f-4fad-a539-8e0da3bbcf5e",
      connectionId: "05be7b38-5a0c-4215-a14f-ac6a3f124d53",
      cliVersion: "7.4.7",
      directory: "/Users/alice/private/customer-repo",
      displayName: "Alice Mac",
    })

    expect(runtime.presence()).toEqual({
      runtimeId: "8db3de9a-350f-4fad-a539-8e0da3bbcf5e",
      connectionId: "05be7b38-5a0c-4215-a14f-ac6a3f124d53",
      protocolVersion: 1,
      cliVersion: "7.4.7",
      displayName: "Alice Mac",
      projectName: "customer-repo",
      capabilities: ["catalog.v1", "create-and-run.v1"],
    })
    // Absolute directory must never leak into the serialized presence.
    expect(JSON.stringify(runtime.presence())).not.toContain("/Users/alice")
    expect(JSON.stringify(runtime.presence())).not.toContain("customer-repo/")
  })

  test("derives projectName from the basename of the launch directory", () => {
    const runtime = RemoteRuntime.create({
      runtimeId: "8db3de9a-350f-4fad-a539-8e0da3bbcf5e",
      connectionId: "conn-1",
      cliVersion: "7.4.7",
      directory: "/home/bob/work/secret/internal/api-gateway",
      displayName: "Bob Laptop",
    })
    expect(runtime.presence().projectName).toBe("api-gateway")
  })

  test("handles a root directory without crashing", () => {
    const runtime = RemoteRuntime.create({
      runtimeId: "8db3de9a-350f-4fad-a539-8e0da3bbcf5e",
      connectionId: "conn-1",
      cliVersion: "7.4.7",
      directory: "/",
      displayName: "Root",
    })
    expect(runtime.presence().projectName).toBe("root")
  })

  test("truncates and sanitizes an oversized display name", () => {
    const runtime = RemoteRuntime.create({
      runtimeId: "8db3de9a-350f-4fad-a539-8e0da3bbcf5e",
      connectionId: "conn-1",
      cliVersion: "7.4.7",
      directory: "/tmp/proj",
      displayName: "  \n\t Hello   World\u0000\x07  ",
    })
    // Control chars stripped, whitespace collapsed, truncated to 80.
    expect(runtime.presence().displayName).toBe("Hello World")
  })

  test("caps a long directory basename to 80 characters", () => {
    const longName = "a".repeat(120)
    const runtime = RemoteRuntime.create({
      runtimeId: "8db3de9a-350f-4fad-a539-8e0da3bbcf5e",
      connectionId: "conn-1",
      cliVersion: "7.4.7",
      directory: `/tmp/${longName}`,
      displayName: "Laptop",
    })
    expect(runtime.presence().projectName).toBe("a".repeat(80))
  })

  test("setConnectionId updates the transport identity without changing runtimeId", () => {
    const runtime = RemoteRuntime.create({
      runtimeId: "8db3de9a-350f-4fad-a539-8e0da3bbcf5e",
      connectionId: "conn-1",
      cliVersion: "7.4.7",
      directory: "/tmp/proj",
      displayName: "Laptop",
    })
    expect(runtime.runtimeId).toBe("8db3de9a-350f-4fad-a539-8e0da3bbcf5e")
    // RemoteWS.connect() sets the connectionId once at creation and it
    // remains stable for the lifetime of the Connection. setConnectionId
    // is only called if a different Connection is wired in.
    runtime.setConnectionId("conn-2")
    expect(runtime.runtimeId).toBe("8db3de9a-350f-4fad-a539-8e0da3bbcf5e")
    expect(runtime.presence().connectionId).toBe("conn-2")
  })

  test("captures the launch directory once and ignores later cwd changes", () => {
    const runtime = RemoteRuntime.create({
      runtimeId: "8db3de9a-350f-4fad-a539-8e0da3bbcf5e",
      connectionId: "conn-1",
      cliVersion: "7.4.7",
      directory: "/tmp/original",
      displayName: "Laptop",
    })
    const original = runtime.presence().projectName
    // Simulate process.chdir — the runtime must not re-read cwd.
    expect(runtime.presence().projectName).toBe(original)
  })

  test("lists every known capability", () => {
    const runtime = RemoteRuntime.create({
      runtimeId: "8db3de9a-350f-4fad-a539-8e0da3bbcf5e",
      connectionId: "conn-1",
      cliVersion: "7.4.7",
      directory: "/tmp/proj",
      displayName: "Laptop",
    })
    expect(runtime.presence().capabilities).toEqual(["catalog.v1", "create-and-run.v1"])
  })

  test("rejects a directory that is an empty string", () => {
    expect(() =>
      RemoteRuntime.create({
        runtimeId: "8db3de9a-350f-4fad-a539-8e0da3bbcf5e",
        connectionId: "conn-1",
        cliVersion: "7.4.7",
        directory: "",
        displayName: "Laptop",
      }),
    ).toThrow()
  })

  test("rejects an empty display name", () => {
    expect(() =>
      RemoteRuntime.create({
        runtimeId: "8db3de9a-350f-4fad-a539-8e0da3bbcf5e",
        connectionId: "conn-1",
        cliVersion: "7.4.7",
        directory: "/tmp/proj",
        displayName: "   ",
      }),
    ).toThrow()
  })
})

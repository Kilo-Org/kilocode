import { expect } from "bun:test"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Rpc } from "@opencode/core/rpc"
import { Effect } from "effect"
import { testEffect } from "../../core/test/lib/effect"
import { PluginTestLayer } from "../../core/test/plugin/fixture"
import { KiloRemote } from "../src/remote"

const it = testEffect(PluginTestLayer)

it.live("remote RPCs bind the authenticated workspace and explicitly attach restored sessions", () =>
  Effect.gen(function* () {
    const plugin = yield* Plugin.Service
    const host = yield* PluginHost.make(plugin)
    const rpc = yield* Rpc.Service
    let enabled = false
    const status = () => Effect.succeed({ enabled, connected: true })
    const directories: string[] = []
    const attached: string[] = []
    const runtime: KiloRemote.Runtime = {
      status,
      enable: () =>
        Effect.sync(() => {
          enabled = true
        }).pipe(Effect.andThen(status)),
      disable: () =>
        Effect.sync(() => {
          enabled = false
        }).pipe(Effect.andThen(status)),
      attach: (sessionID) =>
        Effect.sync(() => {
          attached.push(sessionID)
        }).pipe(Effect.andThen(status)),
    }
    yield* KiloRemote.plugin.effect(host).pipe(
      Effect.provideService(KiloRemote.Service, {
        forDirectory: (directory) =>
          Effect.sync(() => {
            directories.push(directory)
            return runtime
          }),
      }),
    )
    expect(yield* rpc.call("kilocode.remote", "status", {})).toEqual({ enabled: false, connected: true })
    for (const method of ["enable", "enable", "disable", "disable"]) {
      expect(yield* rpc.call("kilocode.remote", method, {})).toEqual({ enabled: method === "enable", connected: true })
    }
    expect(yield* rpc.call("kilocode.remote", "attach", { sessionID: "ses_restored" })).toEqual({
      enabled: false,
      connected: true,
    })
    expect(attached).toEqual(["ses_restored"])
    expect(directories).toEqual(Array(6).fill(host.location.directory))
  }),
)

it.live("remote RPC errors keep the named contract and service failure payload", () =>
  Effect.gen(function* () {
    const plugin = yield* Plugin.Service
    const host = yield* PluginHost.make(plugin)
    const rpc = yield* Rpc.Service
    const fail = () => Effect.fail({ code: "signed_out", message: "Sign in to enable remote control" })
    yield* KiloRemote.plugin.effect(host).pipe(
      Effect.provideService(KiloRemote.Service, {
        forDirectory: fail,
      }),
    )
    for (const method of ["status", "enable", "disable"]) {
      expect(yield* rpc.call("kilocode.remote", method, {}).pipe(Effect.flip)).toMatchObject({
        type: "failed",
        message: "Sign in to enable remote control",
        data: { code: "signed_out", message: "Sign in to enable remote control" },
      })
    }
    expect(yield* rpc.call("kilocode.remote", "attach", { sessionID: "ses_restored" }).pipe(Effect.flip)).toMatchObject(
      {
        type: "failed",
        data: { code: "signed_out" },
      },
    )
  }),
)

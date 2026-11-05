import { expect } from "bun:test"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Rpc } from "@opencode/core/rpc"
import { Effect } from "effect"
import { testEffect } from "../../core/test/lib/effect"
import { PluginTestLayer } from "../../core/test/plugin/fixture"
import { KiloRemote } from "../src/remote"

const it = testEffect(PluginTestLayer)

it.live("remote RPCs delegate status and idempotent toggles to the process service", () =>
  Effect.gen(function* () {
    const plugin = yield* Plugin.Service
    const host = yield* PluginHost.make(plugin)
    const rpc = yield* Rpc.Service
    let enabled = false
    const status = () => Effect.succeed({ enabled, connected: true })
    yield* KiloRemote.plugin.effect(host).pipe(
      Effect.provideService(KiloRemote.Service, {
        status,
        enable: () =>
          Effect.sync(() => {
            enabled = true
          }).pipe(Effect.andThen(status)),
        disable: () =>
          Effect.sync(() => {
            enabled = false
          }).pipe(Effect.andThen(status)),
      }),
    )
    expect(yield* rpc.call("kilocode.remote", "status", {})).toEqual({ enabled: false, connected: true })
    for (const method of ["enable", "enable", "disable", "disable"]) {
      expect(yield* rpc.call("kilocode.remote", method, {})).toEqual({ enabled: method === "enable", connected: true })
    }
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
        status: fail,
        enable: fail,
        disable: fail,
      }),
    )
    for (const method of ["status", "enable", "disable"]) {
      expect(yield* rpc.call("kilocode.remote", method, {}).pipe(Effect.flip)).toMatchObject({
        type: "failed",
        message: "Sign in to enable remote control",
        data: { code: "signed_out", message: "Sign in to enable remote control" },
      })
    }
  }),
)

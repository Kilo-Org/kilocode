import { AllowEverythingPermission } from "@/kilocode/permission/allow-everything" // kilocode_change
import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { Effect, Schema } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { AllowEverythingBody, SaveAlwaysRulesBody } from "../groups/permission" // kilocode_change

export const permissionHandlers = HttpApiBuilder.group(InstanceHttpApi, "permission", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* Permission.Service

    const list = Effect.fn("PermissionHttpApi.list")(function* () {
      return yield* svc.list()
    })

    const reply = Effect.fn("PermissionHttpApi.reply")(function* (ctx: {
      params: { requestID: PermissionID }
      payload: Permission.ReplyBody
    }) {
      const ok = yield* svc.reply({
        requestID: ctx.params.requestID,
        reply: ctx.payload.reply,
        message: ctx.payload.message,
      })
      if (!ok) return yield* new HttpApiError.NotFound({}) // kilocode_change
      return true
    })

    // kilocode_change start
    const saveAlwaysRules = Effect.fn("PermissionHttpApi.saveAlwaysRules")(function* (ctx: {
      params: { requestID: PermissionID }
      payload: Schema.Schema.Type<typeof SaveAlwaysRulesBody>
    }) {
      const ok = yield* svc.saveAlwaysRules({
        requestID: ctx.params.requestID,
        approvedAlways: ctx.payload.approvedAlways ? [...ctx.payload.approvedAlways] : undefined,
        deniedAlways: ctx.payload.deniedAlways ? [...ctx.payload.deniedAlways] : undefined,
      })
      if (!ok) return yield* new HttpApiError.NotFound({})
      return true
    })
    // kilocode_change end

    // kilocode_change start
    const allowEverything = Effect.fn("PermissionHttpApi.allowEverything")(function* (ctx: {
      payload: Schema.Schema.Type<typeof AllowEverythingBody>
    }) {
      return yield* AllowEverythingPermission.effect(ctx.payload)
    })
    // kilocode_change end

    return handlers
      .handle("list", list)
      .handle("reply", reply)
      .handle("saveAlwaysRules", saveAlwaysRules)
      .handle("allowEverything", allowEverything) // kilocode_change
  }),
)

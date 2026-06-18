import { AllowEverythingPermission } from "@/kilocode/permission/allow-everything" // kilocode_change
import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
// kilocode_change start
import { SessionID } from "@/session/schema"
import { Effect, Schema } from "effect"
// kilocode_change end
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { PermissionNotFoundError } from "../errors"
// kilocode_change start
import { AllowEverythingBody, SaveAlwaysRulesBody } from "../groups/permission"
// kilocode_change end

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
      yield* svc
        .reply({
          // kilocode_change
          requestID: ctx.params.requestID,
          reply: ctx.payload.reply,
          message: ctx.payload.message,
        })
        .pipe(
          Effect.catchTag("Permission.NotFoundError", (error) =>
            Effect.fail(
              new PermissionNotFoundError({
                requestID: String(error.requestID),
                message: `Permission request not found: ${error.requestID}`,
              }),
            ),
          ),
        )
      return true
    })

    // kilocode_change start
    const saveAlwaysRules = Effect.fn("PermissionHttpApi.saveAlwaysRules")(function* (ctx: {
      params: { requestID: PermissionID }
      payload: Schema.Schema.Type<typeof SaveAlwaysRulesBody>
    }) {
      yield* svc
        .saveAlwaysRules({
          requestID: ctx.params.requestID,
          approvedAlways: ctx.payload.approvedAlways ? [...ctx.payload.approvedAlways] : undefined,
          deniedAlways: ctx.payload.deniedAlways ? [...ctx.payload.deniedAlways] : undefined,
        })
        .pipe(
          Effect.catchTag("Permission.NotFoundError", (error) =>
            Effect.fail(
              new PermissionNotFoundError({
                requestID: String(error.requestID),
                message: `Permission request not found: ${error.requestID}`,
              }),
            ),
          ),
        )
      return true
    })

    const allowEverything = Effect.fn("PermissionHttpApi.allowEverything")(function* (ctx: {
      payload: Schema.Schema.Type<typeof AllowEverythingBody>
    }) {
      return yield* AllowEverythingPermission.effect({
        enable: ctx.payload.enable,
        requestID: ctx.payload.requestID ? PermissionID.make(ctx.payload.requestID) : undefined,
        sessionID: ctx.payload.sessionID ? SessionID.make(ctx.payload.sessionID) : undefined,
      })
    })

    return handlers
      .handle("list", list)
      .handle("reply", reply)
      .handle("saveAlwaysRules", saveAlwaysRules)
      .handle("allowEverything", allowEverything)
    // kilocode_change end
  }),
)

import * as InstanceState from "@/effect/instance-state"
import { StackService } from "@/kilocode/stack/service"
import { InstanceStore } from "@/project/instance-store"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { markInstanceForDisposal } from "@/server/routes/instance/httpapi/lifecycle"
import { Effect, Exit } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import {
  StackApiMessages,
  StackApplyApiError,
  StackApplyInput,
  StackInvalidConfigApiError,
  StackInvalidDraftApiError,
  StackMarketplaceUnavailableApiError,
  StackMissingResourceApiError,
  StackPreviewInput,
  StackStalePlanApiError,
} from "../groups/stack"

const invalidConfig = () =>
  Effect.fail(
    new StackInvalidConfigApiError({
      code: "invalid_config",
      message: StackApiMessages.invalidConfig,
    }),
  )

const invalidDraft = () =>
  Effect.fail(
    new StackInvalidDraftApiError({
      code: "invalid_draft",
      message: StackApiMessages.invalidDraft,
    }),
  )

const unavailable = () =>
  Effect.fail(
    new StackMarketplaceUnavailableApiError({
      code: "marketplace_unavailable",
      message: StackApiMessages.unavailable,
    }),
  )

export const stackHandlers = HttpApiBuilder.group(InstanceHttpApi, "stack", (handlers) =>
  Effect.gen(function* () {
    const stack = yield* StackService.Service

    const catalog = Effect.fn("StackHttpApi.catalog")(function* () {
      return yield* stack.catalog().pipe(
        Effect.catchTags({
          StackMarketplaceUnavailableError: unavailable,
        }),
      )
    })

    const get = Effect.fn("StackHttpApi.get")(function* () {
      return yield* stack.get().pipe(
        Effect.catchTags({
          StackInvalidConfigError: invalidConfig,
          StackMarketplaceUnavailableError: unavailable,
        }),
      )
    })

    const detect = Effect.fn("StackHttpApi.detect")(function* () {
      return yield* stack.detect()
    })

    const preview = Effect.fn("StackHttpApi.preview")(function* (ctx: { payload: typeof StackPreviewInput.Type }) {
      return yield* stack.preview(ctx.payload.draft).pipe(
        Effect.catchTags({
          StackInvalidConfigError: invalidConfig,
          StackInvalidDraftError: invalidDraft,
        }),
      )
    })

    const apply = Effect.fn("StackHttpApi.apply")(function* (ctx: { payload: typeof StackApplyInput.Type }) {
      const instance = yield* InstanceState.context
      const store = yield* InstanceStore.Service
      const output = yield* stack.apply(ctx.payload.draft, ctx.payload.plan_hash).pipe(
        Effect.onExit((exit) => (Exit.isSuccess(exit) ? markInstanceForDisposal(instance) : Effect.void)),
        Effect.onInterrupt(() => Effect.uninterruptible(store.dispose(instance))),
        Effect.catchTags({
          StackInvalidConfigError: invalidConfig,
          StackInvalidDraftError: invalidDraft,
          StackStalePlanError: () =>
            Effect.fail(
              new StackStalePlanApiError({
                code: "stale_plan",
                message: StackApiMessages.stale,
              }),
            ),
          StackMissingResourceError: (error) =>
            Effect.fail(
              new StackMissingResourceApiError({
                code: "missing_marketplace_resource",
                message: StackApiMessages.missing,
                resources: error.resources,
              }),
            ),
          StackMarketplaceUnavailableError: unavailable,
          StackApplyError: (error) =>
            Effect.uninterruptible(
              Effect.gen(function* () {
                if (!error.rollback) yield* markInstanceForDisposal(instance)
                return yield* new StackApplyApiError({
                  code: "apply_failed",
                  message: StackApiMessages.apply,
                  rollback: error.rollback,
                  results: error.results,
                })
              }),
            ),
        }),
      )
      return output
    })

    return handlers
      .handle("catalog", catalog)
      .handle("get", get)
      .handle("detect", detect)
      .handle("preview", preview)
      .handle("apply", apply)
  }),
)

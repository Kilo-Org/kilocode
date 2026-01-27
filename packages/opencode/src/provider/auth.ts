import { Instance } from "@/project/instance"
import { Plugin } from "../plugin"
import { map, filter, pipe, fromEntries, mapValues } from "remeda"
import z from "zod"
import { fn } from "@/util/fn"
import type { AuthOuathResult, Hooks } from "@opencode-ai/plugin"
import { NamedError } from "@opencode-ai/util/error"
import { Auth } from "@/auth"

export namespace ProviderAuth {
  const state = Instance.state(async () => {
    const methods = pipe(
      await Plugin.list(),
      filter((x) => x.auth?.provider !== undefined),
      map((x) => [x.auth!.provider, x.auth!] as const),
      fromEntries(),
    )
    return { methods, pending: {} as Record<string, AuthOuathResult> }
  })

  export const Method = z
    .object({
      type: z.union([z.literal("oauth"), z.literal("api")]),
      label: z.string(),
    })
    .meta({
      ref: "ProviderAuthMethod",
    })
  export type Method = z.infer<typeof Method>

  export async function methods() {
    const s = await state().then((x) => x.methods)
    return mapValues(s, (x) =>
      x.methods.map(
        (y): Method => ({
          type: y.type,
          label: y.label,
        }),
      ),
    )
  }

  export const Authorization = z
    .object({
      url: z.string(),
      method: z.union([z.literal("auto"), z.literal("code")]),
      instructions: z.string(),
    })
    .meta({
      ref: "ProviderAuthAuthorization",
    })
  export type Authorization = z.infer<typeof Authorization>

  export const authorize = fn(
    z.object({
      providerID: z.string(),
      method: z.number(),
    }),
    async (input): Promise<Authorization | undefined> => {
      const auth = await state().then((s) => s.methods[input.providerID])
      const method = auth.methods[input.method]
      if (method.type === "oauth") {
        const result = await method.authorize()
        await state().then((s) => (s.pending[input.providerID] = result))
        return {
          url: result.url,
          method: result.method,
          instructions: result.instructions,
        }
      }
    },
  )

  // kilocode_change start - Account and CallbackResult types for Kilo Gateway organization selection
  export const Account = z
    .object({
      id: z.string(),
      name: z.string(),
      hint: z.string().optional(),
    })
    .meta({
      ref: "ProviderAuthAccount",
    })
  export type Account = z.infer<typeof Account>

  export const CallbackResult = z
    .object({
      accounts: z.array(Account).optional(),
    })
    .meta({
      ref: "ProviderAuthCallbackResult",
    })
  export type CallbackResult = z.infer<typeof CallbackResult>
  // kilocode_change end

  export const callback = fn(
    z.object({
      providerID: z.string(),
      method: z.number(),
      code: z.string().optional(),
      accountId: z.string().optional(), // kilocode_change - accountId for Kilo Gateway
    }),
    async (input): Promise<CallbackResult> => {
      const match = await state().then((s) => s.pending[input.providerID])
      if (!match) throw new OauthMissing({ providerID: input.providerID })
      let result

      if (match.method === "code") {
        if (!input.code) throw new OauthCodeMissing({ providerID: input.providerID })
        result = await match.callback(input.code)
      }

      if (match.method === "auto") {
        result = await match.callback()
      }

      if (result?.type === "success") {
        if ("key" in result) {
          await Auth.set(input.providerID, {
            type: "api",
            key: result.key,
          })
        }
        if ("refresh" in result) {
          const info: Auth.Info = {
            type: "oauth",
            access: result.access,
            refresh: result.refresh,
            expires: result.expires,
          }
          // kilocode_change start - Use provided accountId or the one from result
          const accountId = input.accountId || result.accountId
          if (accountId) {
            info.accountId = accountId
          }
          // kilocode_change end
          await Auth.set(input.providerID, info)
        }
        return { accounts: result.accounts } // kilocode_change - return accounts for selection
      }

      throw new OauthCallbackFailed({})
    },
  )

  // kilocode_change start - setAccount function for Kilo Gateway organization selection
  export const setAccount = fn(
    z.object({
      providerID: z.string(),
      accountId: z.string(),
    }),
    async (input) => {
      const existing = await Auth.get(input.providerID)
      if (!existing || existing.type !== "oauth") {
        throw new OauthMissing({ providerID: input.providerID })
      }
      await Auth.set(input.providerID, {
        ...existing,
        accountId: input.accountId || undefined,
      })
    },
  )
  // kilocode_change end

  export const api = fn(
    z.object({
      providerID: z.string(),
      key: z.string(),
    }),
    async (input) => {
      await Auth.set(input.providerID, {
        type: "api",
        key: input.key,
      })
    },
  )

  export const OauthMissing = NamedError.create(
    "ProviderAuthOauthMissing",
    z.object({
      providerID: z.string(),
    }),
  )
  export const OauthCodeMissing = NamedError.create(
    "ProviderAuthOauthCodeMissing",
    z.object({
      providerID: z.string(),
    }),
  )

  export const OauthCallbackFailed = NamedError.create("ProviderAuthOauthCallbackFailed", z.object({}))
}

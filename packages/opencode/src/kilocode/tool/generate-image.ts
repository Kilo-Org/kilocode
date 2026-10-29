// kilocode_change - new file
import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import * as path from "path"
import * as Tool from "../../tool/tool"
import * as Auth from "../../auth"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import * as Log from "@opencode-ai/core/util/log"
import { assertExternalDirectoryEffect } from "../../tool/external-directory"
import { Config } from "@/config/config"
import { KILO_OPENROUTER_BASE } from "@kilocode/kilo-gateway"
import DESCRIPTION from "./generate-image.txt"
import * as Images from "../image-generation"
import { Options } from "@opencode-ai/core/kilocode/image-generation"

const log = Log.create({ service: "tool.generate_image" })

const KILO_OPENROUTER_URL = `${KILO_OPENROUTER_BASE}/chat/completions`
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

/** Fallback catalog used when the gateway is unreachable or the user is offline. */
export const FALLBACK_IMAGE_MODELS = [
  { value: "openrouter/auto", label: "Auto Router" },
  { value: "google/gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image" },
  { value: "google/gemini-3-pro-image-preview", label: "Gemini 3 Pro Image Preview" },
  { value: "openai/gpt-5-image", label: "GPT-5 Image" },
  { value: "openai/gpt-5-image-mini", label: "GPT-5 Image Mini" },
  { value: "black-forest-labs/flux.2-flex", label: "Black Forest Labs FLUX.2 Flex" },
  { value: "black-forest-labs/flux.2-pro", label: "Black Forest Labs FLUX.2 Pro" },
] as const

export const DEFAULT_MODEL = "openrouter/auto"

/** Kept for test compatibility. */
export const IMAGE_MODELS = FALLBACK_IMAGE_MODELS

export type ImageFormat = "png" | "jpeg"

const DATA_URL_RE = /^data:image\/(png|jpeg|jpg);base64,(.+)$/

export function parseImageResponse(body: string): { format: ImageFormat; base64: string } | null {
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return null
  }
  const choices = (json as any)?.choices
  const url = choices?.[0]?.message?.images?.[0]?.image_url?.url
  if (typeof url !== "string") return null
  const m = url.match(DATA_URL_RE)
  if (!m) return null
  const format = (m[1] === "jpg" ? "jpeg" : m[1]) as ImageFormat
  return { format, base64: m[2] }
}

export type AuthInput = {
  type: "oauth" | "api"
  access?: string
  key?: string
  accountId?: string
}

export type ResolvedProvider = {
  url: string
  token: string
  provider: "kilo" | "openrouter"
  organizationId?: string
}

export function resolveProvider(
  auth: AuthInput | undefined,
  openRouterKey: string | undefined,
): ResolvedProvider | null {
  const token = auth?.type === "oauth" ? auth.access : auth?.type === "api" ? auth.key : undefined
  if (token) {
    return {
      url: KILO_OPENROUTER_URL,
      token,
      provider: "kilo",
      ...(auth?.type === "oauth" && auth.accountId ? { organizationId: auth.accountId } : {}),
    }
  }
  if (openRouterKey) {
    return { url: OPENROUTER_URL, token: openRouterKey, provider: "openrouter" }
  }
  return null
}

export function ensureExtension(relPath: string, format: ImageFormat): string {
  const ext = format === "jpeg" ? "jpg" : format
  const match = relPath.match(/\.([a-z]+)$/i)
  if (!match) return `${relPath}.${ext}`
  const existing = match[1].toLowerCase()
  const imageExts = ["png", "jpg", "jpeg"]
  if (!imageExts.includes(existing)) return `${relPath}.${ext}`
  const matches = ext === "jpg" ? ["jpg", "jpeg"] : ["png"]
  if (matches.includes(existing)) return relPath
  return `${relPath.slice(0, -match[0].length)}.${ext}`
}

type ResolvedRequest = { url: string; headers: Record<string, string>; body: string }

function buildRequest(resolved: ResolvedProvider, prompt: string, model: string, images: string[]): ResolvedRequest {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${resolved.token}`,
    "Content-Type": "application/json",
  }
  if (resolved.organizationId) headers["X-KILOCODE-ORGANIZATIONID"] = resolved.organizationId

  const content = images.length
    ? [{ type: "text", text: prompt }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))]
    : prompt

  return {
    url: resolved.url,
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content }],
      modalities: ["image", "text"],
    }),
  }
}

const Parameters = Schema.Struct({
  ...Options.fields,
  prompt: Schema.String.annotate({ description: "Text description of the image to generate or the edits to apply" }),
  path: Schema.String.annotate({
    description: "Filesystem path (relative to the workspace) where the resulting image should be saved",
  }),
  image: Schema.optional(Schema.String).annotate({
    description:
      "Optional path (relative to the workspace) to an existing image to edit; supports PNG, JPG, JPEG, GIF, and WEBP",
  }),
  images: Schema.optional(
    Schema.Array(Schema.String.check(Schema.isMinLength(1))).check(Schema.isMinLength(1), Schema.isMaxLength(10)),
  ).annotate({
    description:
      "Ordered reference image paths, relative to the workspace. Use either image or images, not both. Up to 10 references; custom endpoints support PNG/JPEG.",
  }),
  model: Schema.optional(Schema.String).annotate({
    description: "Model ID to use for image generation. Omit to use the configured default.",
  }),
})

type Meta = {
  format?: ImageFormat
  filepath?: string
  provider?: "kilo" | "openrouter" | "custom"
  error?: string
}

export const GenerateImageTool = Tool.define(
  "generate_image",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const authSvc = yield* Auth.Service
    const configSvc = yield* Config.Service
    const http = yield* HttpClient.HttpClient

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          if (params.image != null && params.images != null) throw new Error("Provide either image or images, not both")
          const cfg = yield* configSvc.get()
          const custom = Images.source(yield* configSvc.getGlobal())
          const options = {
            size: params.size ?? custom?.options?.size,
            background: params.background ?? custom?.options?.background,
            seed: params.seed ?? custom?.options?.seed,
            steps: params.steps ?? custom?.options?.steps,
          }
          if (!custom && Object.values(options).some((value) => value != null))
            throw new Error("Image size, background, seed, and steps options require a custom Images API endpoint")
          const auth = custom ? undefined : yield* authSvc.get("kilo")
          const authInput: AuthInput | undefined = auth
            ? {
                type: auth.type === "api" ? "api" : "oauth",
                ...(auth.type === "api" ? { key: auth.key } : {}),
                ...(auth.type === "oauth" ? { access: auth.access } : {}),
                ...(auth.type === "oauth" && auth.accountId ? { accountId: auth.accountId } : {}),
              }
            : undefined
          const resolved = custom ? null : resolveProvider(authInput, process.env["OPENROUTER_API_KEY"])
          if (!custom && !resolved) {
            return {
              title: "Image generation unavailable",
              output: "Configure a custom image endpoint, log in to Kilo, or set OPENROUTER_API_KEY, then try again.",
              metadata: { error: "no-provider" } as Meta,
            }
          }

          const provider = resolved?.provider ?? "custom"
          yield* ctx.metadata({
            title: `Generate image "${params.prompt.slice(0, 60)}"`,
            metadata: { provider },
          })

          const paths = params.images ?? (params.image ? [params.image] : [])
          const input = yield* Effect.forEach(paths, (name) =>
            Effect.gen(function* () {
              const file = path.resolve(instance.directory, name)
              yield* assertExternalDirectoryEffect(ctx, file)
              yield* ctx.ask({
                permission: "read",
                patterns: [path.relative(instance.worktree, file)],
                always: ["*"],
                metadata: { filepath: file },
              })
              const ext = path.extname(file).slice(1).toLowerCase() || "png"
              const mime = `image/${ext === "jpg" ? "jpeg" : ext}`
              if (custom && mime !== "image/png" && mime !== "image/jpeg")
                throw new Error("Custom image edits support PNG and JPEG reference images")
              const bytes = yield* Effect.tryPromise(() => Bun.file(file).bytes())
              return { bytes, mime, name: path.basename(file) }
            }),
          )
          const model =
            params.model ?? (custom ? custom.model : (cfg.experimental?.image_generation_model ?? DEFAULT_MODEL))
          const generated = custom
            ? yield* Images.generate(http, custom, {
                prompt: params.prompt,
                model,
                images: input,
                options,
                signal: ctx.abort,
              })
            : undefined
          const req = resolved
            ? buildRequest(
                resolved,
                params.prompt,
                model ?? DEFAULT_MODEL,
                input.map((image) => `data:${image.mime};base64,${Buffer.from(image.bytes).toString("base64")}`),
              )
            : undefined
          const response = req
            ? yield* http.execute(
                HttpClientRequest.post(req.url).pipe(
                  HttpClientRequest.setHeaders(req.headers),
                  HttpClientRequest.bodyText(req.body, "application/json"),
                ),
              )
            : undefined

          const status = response?.status
          if (response && status != null && (status < 200 || status >= 300)) {
            const errText = yield* response.text
            log.warn("image generation failed", { status, errText: errText.slice(0, 200) })
            return {
              title: "Image generation failed",
              output: `Image generation request failed (HTTP ${status}).`,
              metadata: { provider, error: "http-error" } as Meta,
            }
          }

          const parsed = generated ?? (response ? parseImageResponse(yield* response.text) : null)
          if (!parsed) {
            return {
              title: "Image generation produced no image",
              output: "The model did not return an image. Try a different prompt or model.",
              metadata: { provider, error: "no-image" } as Meta,
            }
          }

          const finalPath = ensureExtension(params.path, parsed.format)
          const absPath = path.isAbsolute(finalPath) ? finalPath : path.join(instance.directory, finalPath)
          yield* assertExternalDirectoryEffect(ctx, absPath)
          yield* ctx.ask({
            permission: "write",
            patterns: [path.relative(instance.worktree, absPath)],
            always: ["*"],
            metadata: { filepath: absPath },
          })

          const buf = Buffer.from(parsed.base64, "base64")
          yield* fs.writeWithDirs(absPath, buf)

          return {
            title: path.relative(instance.worktree, absPath),
            output: `Image saved to ${finalPath}.`,
            metadata: {
              format: parsed.format,
              filepath: absPath,
              provider,
            } as Meta,
            attachments: [
              {
                type: "file" as const,
                mime: `image/${parsed.format}`,
                url: `data:image/${parsed.format};base64,${parsed.base64}`,
                filename: path.basename(absPath),
              },
            ],
          }
        }).pipe(Effect.orDie),
    }
  }),
)

// kilocode_change - new file
import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import * as path from "path"
import { readFile } from "fs/promises"
import * as Tool from "../../tool/tool"
import * as Auth from "../../auth"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { InstanceState } from "@/effect/instance-state"
import * as Log from "@opencode-ai/core/util/log"
import { assertExternalDirectoryEffect } from "../../tool/external-directory"
import { Config } from "@/config/config"
import DESCRIPTION from "./generate-image.txt"

const log = Log.create({ service: "tool.generate_image" })

const KILO_OPENROUTER_URL = `${process.env["KILO_API_URL"] ?? "https://api.kilo.ai"}/api/openrouter/chat/completions`
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

function buildRequest(resolved: ResolvedProvider, prompt: string, model: string, inputImage?: string): ResolvedRequest {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${resolved.token}`,
    "Content-Type": "application/json",
  }
  if (resolved.organizationId) headers["X-KILOCODE-ORGANIZATIONID"] = resolved.organizationId

  const content = inputImage
    ? [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: inputImage } },
      ]
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
  prompt: Schema.String.annotate({ description: "Text description of the image to generate or the edits to apply" }),
  path: Schema.String.annotate({
    description: "Filesystem path (relative to the workspace) where the resulting image should be saved",
  }),
  image: Schema.optional(Schema.String).annotate({
    description:
      "Optional path (relative to the workspace) to an existing image to edit; supports PNG, JPG, JPEG, GIF, and WEBP",
  }),
  model: Schema.optional(Schema.String).annotate({
    description: "Model ID to use for image generation. Omit to use the configured default.",
  }),
})

type Meta = {
  format?: ImageFormat
  filepath?: string
  provider?: "kilo" | "openrouter"
  error?: string
}

export const GenerateImageTool = Tool.define(
  "generate_image",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const authSvc = yield* Auth.Service
    const configSvc = yield* Config.Service
    const http = yield* HttpClient.HttpClient

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const auth = yield* authSvc.get("kilo")
          const authInput: AuthInput | undefined = auth
            ? {
                type: auth.type === "api" ? "api" : "oauth",
                ...(auth.type === "api" ? { key: auth.key } : {}),
                ...(auth.type === "oauth" ? { access: auth.access } : {}),
                ...(auth.type === "oauth" && auth.accountId ? { accountId: auth.accountId } : {}),
              }
            : undefined
          const resolved = resolveProvider(authInput, process.env["OPENROUTER_API_KEY"])
          if (!resolved) {
            return {
              title: "Image generation unavailable",
              output:
                "No image generation provider available. Log in to Kilo or set OPENROUTER_API_KEY, then try again.",
              metadata: { error: "no-provider" } as Meta,
            }
          }

          yield* ctx.metadata({
            title: `Generate image "${params.prompt.slice(0, 60)}"`,
            metadata: { provider: resolved.provider },
          })

          let inputImage: string | undefined
          if (params.image) {
            const imgPath = path.isAbsolute(params.image) ? params.image : path.join(instance.directory, params.image)
            yield* assertExternalDirectoryEffect(ctx, imgPath)
            const buf = yield* Effect.tryPromise(() => readFile(imgPath))
            const ext = path.extname(imgPath).slice(1).toLowerCase() || "png"
            const mime = ext === "jpg" ? "jpeg" : ext
            inputImage = `data:image/${mime};base64,${buf.toString("base64")}`
          }

          const cfg = yield* configSvc.get()
          const model = params.model ?? cfg.experimental?.image_generation_model ?? DEFAULT_MODEL
          const req = buildRequest(resolved, params.prompt, model, inputImage)

          const response = yield* http.execute(
            HttpClientRequest.post(req.url).pipe(
              HttpClientRequest.setHeaders(req.headers),
              HttpClientRequest.bodyText(req.body, "application/json"),
            ),
          )

          const status = response.status
          if (status < 200 || status >= 300) {
            const errText = yield* response.text
            log.warn("image generation failed", { status, errText: errText.slice(0, 200) })
            return {
              title: "Image generation failed",
              output: `Image generation request failed (HTTP ${status}).`,
              metadata: { provider: resolved.provider, error: "http-error" } as Meta,
            }
          }

          const text = yield* response.text
          const parsed = parseImageResponse(text)
          if (!parsed) {
            return {
              title: "Image generation produced no image",
              output: "The model did not return an image. Try a different prompt or model.",
              metadata: { provider: resolved.provider, error: "no-image" } as Meta,
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
              provider: resolved.provider,
            } as Meta,
            attachments: [
              {
                type: "file" as const,
                mime: `image/${parsed.format}`,
                url: `file://${absPath}`,
                filename: path.basename(absPath),
              },
            ],
          }
        }).pipe(Effect.orDie),
    }
  }),
)

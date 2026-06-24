import path from "node:path"
import { Effect, Schema } from "effect"
import { McpResolutionError, MarketplaceManifestError } from "./errors"
import {
  type McpItem,
  type McpMethod,
  type McpTemplate,
  type Parameter,
  type ParameterValue,
  ResolvedMcp,
} from "./schema"

const placeholder = /\{(param|env):([^}]+)\}/g
const environment = /^\{env:[A-Z_][A-Z0-9_]*\}$/
const secretValue = /^(?:(?:Bearer|Basic) )?\{env:[A-Z_][A-Z0-9_]*\}$/
const secretName = /(?:^|[-_\s])(?:authorization|api[-_\s]?key|token|secret|password|credential)(?:$|[-_\s])/i
const querySecret = /[?&](?:api[-_]?key|token|secret|password|credential)=([^&#]*)/gi
const header = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const argument = /^--?(?:authorization|api[-_]?key|token|secret|password|credential)(?:=(.*))?$/i
const control = /[\u0000-\u001f\u007f]/

type Reference = { readonly kind: "param" | "env"; readonly id: string }

function references(value: string): ReadonlyArray<Reference> | undefined {
  const found: Reference[] = []
  let offset = 0
  for (const match of value.matchAll(placeholder)) {
    const index = match.index ?? 0
    if (/[{}]/.test(value.slice(offset, index))) return undefined
    found.push({ kind: match[1] === "param" ? "param" : "env", id: match[2] })
    offset = index + match[0].length
  }
  if (/[{}]/.test(value.slice(offset))) return undefined
  return found
}

function credentials(value: string) {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  return Boolean(url.username || url.password)
}

function entries(template: McpTemplate) {
  const values: Array<{ key: string; value: string }> = []
  if (template.type === "local") {
    template.command.forEach((value, index) => values.push({ key: `command.${index}`, value }))
    for (const [key, value] of Object.entries(template.environment ?? {})) {
      values.push({ key: `environment.${key}`, value })
    }
    return values
  }

  values.push({ key: "url", value: template.url })
  for (const [key, value] of Object.entries(template.headers ?? {})) {
    values.push({ key: `headers.${key}`, value })
  }
  if (!template.oauth) return values
  for (const key of ["clientId", "clientSecret", "scope", "redirectUri"] as const) {
    const value = template.oauth[key]
    if (value !== undefined) values.push({ key: `oauth.${key}`, value })
  }
  return values
}

function issue(item: McpItem, method: McpMethod): MarketplaceManifestError | undefined {
  const definitions = new Map<string, Parameter>()
  for (const definition of method.parameters) {
    if (definitions.has(definition.id)) {
      return new MarketplaceManifestError({ reason: "duplicate_parameter", item: `${item.id}:${method.id}` })
    }
    definitions.set(definition.id, definition)
    if (secretName.test(definition.id) && !definition.sensitive) {
      return new MarketplaceManifestError({ reason: "invalid_parameter", item: `${item.id}:${method.id}` })
    }
    if (
      definition.sensitive &&
      (definition.type !== "string" ||
        !definition.environment ||
        definition.default !== undefined ||
        definition.allowed_values !== undefined)
    ) {
      return new MarketplaceManifestError({ reason: "invalid_parameter", item: `${item.id}:${method.id}` })
    }
    if (!definition.sensitive && definition.environment) {
      return new MarketplaceManifestError({ reason: "invalid_parameter", item: `${item.id}:${method.id}` })
    }
    if (definition.default !== undefined && !valid(definition, definition.default)) {
      return new MarketplaceManifestError({ reason: "invalid_parameter", item: `${item.id}:${method.id}` })
    }
    if (definition.allowed_values?.some((value) => !valid(definition, value))) {
      return new MarketplaceManifestError({ reason: "invalid_parameter", item: `${item.id}:${method.id}` })
    }
  }

  const declared = method.auth.environment ?? []
  const envs = new Set<string>(declared)
  if (envs.size !== declared.length) {
    return new MarketplaceManifestError({ reason: "invalid_parameter", item: `${item.id}:${method.id}` })
  }
  for (const definition of method.parameters) {
    if (definition.environment) envs.add(definition.environment)
  }
  if (method.auth.mode === "none" && envs.size > 0) {
    return new MarketplaceManifestError({ reason: "invalid_parameter", item: `${item.id}:${method.id}` })
  }
  if (method.auth.mode === "environment" && envs.size === 0) {
    return new MarketplaceManifestError({ reason: "invalid_parameter", item: `${item.id}:${method.id}` })
  }

  const used = new Set<string>()
  for (const value of entries(method.template)) {
    if (control.test(value.value) || credentials(value.value)) {
      return new MarketplaceManifestError({ reason: "unsafe_template", item: `${item.id}:${method.id}` })
    }
    const refs = references(value.value)
    if (!refs) return new MarketplaceManifestError({ reason: "unsafe_template", item: `${item.id}:${method.id}` })
    for (const ref of refs) {
      if (ref.kind === "param") {
        const definition = definitions.get(ref.id)
        if (!definition || definition.sensitive) {
          return new MarketplaceManifestError({ reason: "unsafe_template", item: `${item.id}:${method.id}` })
        }
        continue
      }
      if (!envs.has(ref.id)) {
        return new MarketplaceManifestError({ reason: "unsafe_template", item: `${item.id}:${method.id}` })
      }
      used.add(ref.id)
    }
  }
  if (Array.from(envs).some((name) => !used.has(name))) {
    return new MarketplaceManifestError({ reason: "unsafe_template", item: `${item.id}:${method.id}` })
  }

  if (method.template.type === "local") {
    if (references(method.template.command[0])?.length) {
      return new MarketplaceManifestError({ reason: "unsafe_template", item: `${item.id}:${method.id}` })
    }
    for (const [index, value] of method.template.command.entries()) {
      if (index === 0) continue
      const match = value.match(argument)
      if (!match) continue
      const supplied = match[1] ?? method.template.command[index + 1]
      if (!supplied || !environment.test(supplied)) {
        return new MarketplaceManifestError({ reason: "unsafe_template", item: `${item.id}:${method.id}` })
      }
    }
    for (const [key, value] of Object.entries(method.template.environment ?? {})) {
      if (secretName.test(key) && !environment.test(value)) {
        return new MarketplaceManifestError({ reason: "unsafe_template", item: `${item.id}:${method.id}` })
      }
    }
    return undefined
  }

  for (const [key, value] of Object.entries(method.template.headers ?? {})) {
    if (!header.test(key) || (secretName.test(key) && !secretValue.test(value))) {
      return new MarketplaceManifestError({ reason: "unsafe_template", item: `${item.id}:${method.id}` })
    }
  }
  for (const match of method.template.url.matchAll(querySecret)) {
    if (!environment.test(match[1])) {
      return new MarketplaceManifestError({ reason: "unsafe_template", item: `${item.id}:${method.id}` })
    }
  }
  const secret = method.template.oauth ? method.template.oauth.clientSecret : undefined
  if (secret && !environment.test(secret)) {
    return new MarketplaceManifestError({ reason: "unsafe_template", item: `${item.id}:${method.id}` })
  }
  return undefined
}

function valid(definition: Parameter, value: ParameterValue) {
  const typed = (() => {
    if (definition.type === "integer") return typeof value === "number" && Number.isInteger(value)
    if (definition.type === "boolean") return typeof value === "boolean"
    if (
      typeof value !== "string" ||
      value.length > 2_048 ||
      (definition.required && value.length === 0) ||
      control.test(value) ||
      /[{}]/.test(value)
    ) {
      return false
    }
    if (definition.type === "path") return !path.isAbsolute(value) && !value.split(/[\\/]/).includes("..")
    if (definition.type !== "url") return true
    return secureUrl(value)
  })()
  if (!typed) return false
  if (!definition.allowed_values) return true
  return definition.allowed_values.some((allowed) => allowed === value)
}

function secureUrl(value: string) {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  if (url.username || url.password) return false
  if (url.protocol === "https:") return true
  return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost")
}

function replace(value: string, values: ReadonlyMap<string, ParameterValue>) {
  const result = Array.from(values).reduce(
    (text, [key, next]) => text.split(`{param:${key}}`).join(String(next)),
    value,
  )
  if (/\{param:[^}]*\}/.test(result)) return undefined
  return result
}

export function validateMcpMethod(item: McpItem, method: McpMethod): Effect.Effect<void, MarketplaceManifestError> {
  const error = issue(item, method)
  return error ? Effect.fail(error) : Effect.void
}

export const resolveMcp = Effect.fn("Marketplace.resolveMcp")(function* (input: {
  readonly item: McpItem
  readonly method: string
  readonly parameters?: Readonly<Record<string, ParameterValue>>
}) {
  if (!input.item.installability.installable) {
    return yield* new McpResolutionError({
      id: input.item.id,
      method: input.method,
      reason: "not_installable",
    })
  }
  const method = input.item.methods.find((candidate) => candidate.id === input.method)
  if (!method) {
    return yield* new McpResolutionError({
      id: input.item.id,
      method: input.method,
      reason: "method_not_found",
    })
  }
  yield* validateMcpMethod(input.item, method).pipe(
    Effect.mapError(
      () => new McpResolutionError({ id: input.item.id, method: input.method, reason: "unsafe_template" }),
    ),
  )

  const values = new Map<string, ParameterValue>()
  const definitions = new Map<string, Parameter>(method.parameters.map((definition) => [definition.id, definition]))
  for (const [key, value] of Object.entries(input.parameters ?? {})) {
    const definition = definitions.get(key)
    if (!definition) {
      return yield* new McpResolutionError({
        id: input.item.id,
        method: input.method,
        reason: "unknown_parameter",
        parameter: key,
      })
    }
    if (definition.sensitive) {
      return yield* new McpResolutionError({
        id: input.item.id,
        method: input.method,
        reason: "sensitive_parameter",
        parameter: key,
      })
    }
    if (!valid(definition, value)) {
      return yield* new McpResolutionError({
        id: input.item.id,
        method: input.method,
        reason: "invalid_parameter",
        parameter: key,
      })
    }
    values.set(key, value)
  }
  for (const definition of method.parameters) {
    if (definition.sensitive) continue
    if (!values.has(definition.id) && definition.default !== undefined) values.set(definition.id, definition.default)
    if (definition.required && !values.has(definition.id)) {
      return yield* new McpResolutionError({
        id: input.item.id,
        method: input.method,
        reason: "missing_parameter",
        parameter: definition.id,
      })
    }
  }

  const render = (value: string): Effect.Effect<string, McpResolutionError> => {
    const rendered = replace(value, values)
    return rendered === undefined
      ? Effect.fail(new McpResolutionError({ id: input.item.id, method: input.method, reason: "unsafe_template" }))
      : Effect.succeed(rendered)
  }
  const decode = (value: unknown) =>
    Schema.decodeUnknownEffect(ResolvedMcp)(value, { onExcessProperty: "error" }).pipe(
      Effect.mapError(
        () => new McpResolutionError({ id: input.item.id, method: input.method, reason: "unsafe_template" }),
      ),
    )

  const template = method.template
  if (template.type === "local") {
    const command = yield* Effect.forEach(template.command, render)
    const environment = yield* Effect.forEach(Object.entries(template.environment ?? {}), ([key, value]) =>
      render(value).pipe(Effect.map((next) => [key, next] as const)),
    )
    return yield* decode({
      type: "local",
      command,
      ...(environment.length ? { environment: Object.fromEntries(environment) } : {}),
      enabled: false,
      ...(template.timeout === undefined ? {} : { timeout: template.timeout }),
    })
  }

  const url = yield* render(template.url)
  if (!secureUrl(url)) {
    return yield* new McpResolutionError({
      id: input.item.id,
      method: input.method,
      reason: "insecure_remote_url",
    })
  }
  const headers = yield* Effect.forEach(Object.entries(template.headers ?? {}), ([key, value]) =>
    render(value).pipe(Effect.map((next) => [key, next] as const)),
  )
  const oauth = yield* Effect.gen(function* () {
    if (!template.oauth) return template.oauth
    const clientId = template.oauth.clientId ? yield* render(template.oauth.clientId) : undefined
    const clientSecret = template.oauth.clientSecret ? yield* render(template.oauth.clientSecret) : undefined
    const scope = template.oauth.scope ? yield* render(template.oauth.scope) : undefined
    const redirectUri = template.oauth.redirectUri ? yield* render(template.oauth.redirectUri) : undefined
    return {
      ...(clientId === undefined ? {} : { clientId }),
      ...(clientSecret === undefined ? {} : { clientSecret }),
      ...(scope === undefined ? {} : { scope }),
      ...(template.oauth.callbackPort === undefined ? {} : { callbackPort: template.oauth.callbackPort }),
      ...(redirectUri === undefined ? {} : { redirectUri }),
    }
  })
  return yield* decode({
    type: "remote",
    url,
    ...(headers.length ? { headers: Object.fromEntries(headers) } : {}),
    ...(oauth === undefined ? {} : { oauth }),
    enabled: false,
    ...(template.timeout === undefined ? {} : { timeout: template.timeout }),
  })
})

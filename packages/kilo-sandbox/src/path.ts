import { lstatSync, readlinkSync, realpathSync } from "node:fs"
import path from "node:path"
import { Effect, PlatformError } from "effect"
import type { PathRule, Profile, SocketPolicy } from "./profile"

function code(cause: unknown) {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return undefined
  return typeof cause.code === "string" ? cause.code : undefined
}

function resolve(input: string, seen = new Set<string>()) {
  const target = path.resolve(input)
  if (seen.has(target)) throw Object.assign(new Error("Symlink cycle"), { code: "ELOOP" })
  seen.add(target)
  const suffix: Array<string> = []
  let ancestor = target

  while (true) {
    try {
      return path.resolve(realpathSync.native(ancestor), ...suffix)
    } catch (cause) {
      const tag = code(cause)
      if (tag !== "ENOENT" && tag !== "ENOTDIR" && tag !== "EOPNOTSUPP") throw cause
      try {
        if (lstatSync(ancestor).isSymbolicLink()) {
          const link = readlinkSync(ancestor)
          return resolve(path.resolve(path.dirname(ancestor), link, ...suffix), seen)
        }
      } catch (error) {
        if (code(error) !== "ENOENT" && code(error) !== "ENOTDIR") throw error
      }
      const parent = path.dirname(ancestor)
      if (parent === ancestor) throw cause
      suffix.unshift(path.basename(ancestor))
      ancestor = parent
    }
  }
}

function attempt(input: string, method: string, fn: () => string): Effect.Effect<string, PlatformError.PlatformError> {
  return Effect.try({
    try: fn,
    catch: (cause) =>
      PlatformError.systemError({
        _tag: code(cause) === "EACCES" || code(cause) === "EPERM" ? "PermissionDenied" : "Unknown",
        module: "Sandbox",
        method,
        pathOrDescriptor: input,
        description: "Could not resolve the path",
        cause,
      }),
  })
}

export function canonicalize(input: string): Effect.Effect<string, PlatformError.PlatformError> {
  return attempt(input, "canonicalize", () => resolve(input))
}

export function canonicalizeEntry(input: string): Effect.Effect<string, PlatformError.PlatformError> {
  return attempt(input, "canonicalizeEntry", () => path.join(resolve(path.dirname(input)), path.basename(input)))
}

function normalizeRule(rule: PathRule) {
  return Effect.map(canonicalize(rule.path), (target): PathRule => ({ path: target, kind: rule.kind }))
}

function normalizeSocket(policy: SocketPolicy): Effect.Effect<SocketPolicy, PlatformError.PlatformError> {
  return Effect.map(Effect.forEach(policy.paths, normalizeRule), (paths) => ({
    paths: [...new Map(paths.map((rule) => [rule.path, rule])).values()],
    deny: [...new Set(policy.deny)],
    coverage: [...new Set(policy.coverage)],
  }))
}

function platformSocket(profile: Profile) {
  if (process.platform === "linux" || !profile.socket) return profile.socket
  return { ...profile.socket, policy: undefined }
}

export function normalize(profile: Profile): Effect.Effect<Profile, PlatformError.PlatformError> {
  return Effect.gen(function* () {
    const allowWrite = yield* Effect.forEach(profile.filesystem.allowWrite, normalizeRule)
    const denyWrite = yield* Effect.forEach(profile.filesystem.denyWrite, normalizeRule)
    const temporaryDirectory = profile.filesystem.temporaryDirectory
      ? yield* canonicalize(profile.filesystem.temporaryDirectory)
      : undefined
    const socket = platformSocket(profile)
    const policy = socket?.policy ? yield* normalizeSocket(socket.policy) : undefined

    return {
      ...profile,
      ...(socket ? { socket: { ...socket, ...(policy ? { policy } : {}) } } : {}),
      filesystem: {
        allowWrite,
        denyWrite,
        denyNames: profile.filesystem.denyNames,
        ...(temporaryDirectory === undefined ? {} : { temporaryDirectory }),
      },
    }
  })
}

export function matches(rule: PathRule, target: string) {
  const relative = path.relative(rule.path, target)
  if (relative === "") return true
  if (rule.kind === "literal") return false
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

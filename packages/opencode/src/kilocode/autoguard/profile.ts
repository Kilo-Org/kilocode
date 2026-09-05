import type { Profile } from "@kilocode/sandbox"
import { inside } from "./resources"

/** Intersection only: nesting AutoGuard may never widen a native permission. */
export function intersect(profile: Profile, parent?: Profile): Profile {
  if (!parent) return profile
  const contains = (a: Profile["filesystem"]["allowWrite"][number], b: typeof a) =>
    (a.path === b.path && (a.kind === "subtree" || b.kind === "literal")) ||
    (a.kind === "subtree" && inside(a.path, b.path))
  const writes = profile.filesystem.allowWrite.flatMap((a) =>
    parent.filesystem.allowWrite.flatMap((b) => (contains(a, b) ? [b] : contains(b, a) ? [a] : [])),
  )
  const mode =
    profile.network.mode === "deny" || parent.network.mode === "deny"
      ? "deny"
      : profile.network.mode === "allow" && parent.network.mode === "allow"
        ? "allow"
        : "proxy"
  const hosts =
    parent.network.mode === "allow"
      ? profile.network.allowedHosts
      : profile.network.mode === "allow"
        ? parent.network.allowedHosts
        : profile.network.allowedHosts.filter((host) => parent.network.allowedHosts.includes(host))
  return {
    filesystem: {
      ...profile.filesystem,
      allowWrite: writes,
      denyWrite: [...parent.filesystem.denyWrite, ...profile.filesystem.denyWrite],
      denyNames: [...new Set([...parent.filesystem.denyNames, ...profile.filesystem.denyNames])],
    },
    network: { mode, allowedHosts: hosts },
    environment: {
      deny: [...new Set([...parent.environment.deny, ...profile.environment.deny])],
      set: {
        ...profile.environment.set,
        ...parent.environment.set,
        ...Object.fromEntries(
          ["TMPDIR", "TMP", "TEMP"]
            .filter((key) => profile.environment.set[key])
            .map((key) => [key, profile.environment.set[key]]),
        ),
      },
    },
  }
}

import type { Profile } from "./profile"

export function networkPolicy(profile: Profile) {
  if (profile.network.mode === "allow") {
    return "; sandbox network mode: allow\n(allow network-outbound)\n(allow network-inbound)"
  }
  return [
    `; sandbox network mode: ${profile.network.mode}`,
    '(deny network-outbound (with message "Sandbox denied outbound network access"))',
    "(allow network-inbound)",
  ].join("\n")
}

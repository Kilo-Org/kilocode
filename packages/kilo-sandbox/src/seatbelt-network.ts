import type { Profile } from "./profile"
import type { ProxyRuntime } from "./proxy"

export function networkPolicy(profile: Profile, proxy?: ProxyRuntime) {
  if (profile.network.mode === "allow") {
    return "; sandbox network mode: allow\n(allow network-outbound)\n(allow network-inbound)"
  }
  if (profile.network.mode === "proxy" && proxy?.port) {
    return [
      "; sandbox network mode: proxy",
      '(deny network-outbound (with message "Sandbox denied direct outbound network access"))',
      '(deny network-inbound (with message "Sandbox denied inbound network access"))',
      `(allow network-outbound (remote ip "localhost:${proxy.port}"))`,
    ].join("\n")
  }
  return [
    `; sandbox network mode: ${profile.network.mode}`,
    '(deny network-outbound (with message "Sandbox denied outbound network access"))',
    "(allow network-inbound)",
  ].join("\n")
}

// Stubbed for Relay: removed the default and the allowlist of
// supermassive-black-hole.kiloapps.io. With session-export now no-op'd
// upstream, this resolver only returns a string when an explicit endpoint
// override is passed in.

export const defaultEndpoint = ""

export function resolveEndpoint(opts: { endpoint?: string; env?: string; allowCustom?: boolean }): string {
  return opts.endpoint ?? opts.env ?? defaultEndpoint
}

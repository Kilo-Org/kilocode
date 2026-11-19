/** Only messages constructed by this adapter may cross the RPC boundary. */
export class HostedError extends Error {}

/** An acknowledged creation is not yet visible in the workspace's session projection. */
export class HostedPreparing extends HostedError {}

/** Authorization or session identity was lost. Cached private state must no longer be served. */
export class SessionUnavailable extends HostedError {}

export function invalid(): never {
  throw new HostedError("Kilo Cloud returned an invalid response")
}

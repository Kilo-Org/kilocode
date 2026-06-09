const KINDS = ["preparing", "ready", "finalizing", "error"] as const
const STEPS = [
  "disk_check",
  "workspace_setup",
  "cloning",
  "branch",
  "devcontainer_setup",
  "setup_commands",
  "kilo_server",
  "kilo_session",
  "ready",
  "failed",
] as const

export type CloudStatus = {
  type: (typeof KINDS)[number]
  step?: (typeof STEPS)[number]
}

export type CloudStatusEvent = { sessionID: string; cloudStatus: CloudStatus }

const kinds = new Set<unknown>(KINDS)
const steps = new Set<unknown>(STEPS)

export function parseCloudStatus(input: unknown): CloudStatusEvent | undefined {
  if (!object(input) || input.type !== "cloud.status" || !object(input.properties)) return
  const props = input.properties
  if (typeof props.sessionID !== "string" || !object(props.cloudStatus) || !kinds.has(props.cloudStatus.type)) return
  const status: CloudStatus = { type: props.cloudStatus.type as CloudStatus["type"] }
  if (steps.has(props.cloudStatus.step)) status.step = props.cloudStatus.step as NonNullable<CloudStatus["step"]>
  return { sessionID: props.sessionID, cloudStatus: status }
}

function object(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

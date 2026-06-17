export type CloudMessageFailure = {
  sessionID: string
  messageID: string
  status: "failed" | "interrupted"
}

export function parseCloudMessageFailure(input: unknown): CloudMessageFailure | undefined {
  if (!object(input) || input.type !== "cloud.message.failed" || !object(input.properties)) return
  const props = input.properties
  if (
    typeof props.sessionID !== "string" ||
    !props.sessionID ||
    typeof props.messageId !== "string" ||
    !props.messageId ||
    (props.status !== "failed" && props.status !== "interrupted") ||
    props.delivery !== "queued" ||
    props.accepted !== false
  )
    return
  return { sessionID: props.sessionID, messageID: props.messageId, status: props.status }
}

function object(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

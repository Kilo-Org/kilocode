import { createMemo } from "solid-js"
import { useSession } from "../../context/session"

/**
 * The boundary of the current run.
 *
 * A run starts with each real user message. A background result arrives as a
 * synthetic user message, so it is not a new run, or each finished agent would
 * clear the ones before it. The agent stack and the todo chip both need this
 * boundary and must agree on it, so it lives in one place.
 */
export function useRunBoundary() {
  const session = useSession()
  const result = (id: string) =>
    session.getParts(id).some((part) => part.type === "text" && part.synthetic && part.metadata?.background === true)
  const user = createMemo(() => session.messages().findLast((msg) => msg.role === "user" && !result(msg.id))?.id)
  return { result, user }
}

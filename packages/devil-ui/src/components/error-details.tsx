import type { AssistantMessage } from "@kilocode/sdk/v2/client"

type ErrorType = NonNullable<AssistantMessage["error"]>

interface ErrorDetailsProps {
  error: ErrorType
}

export function ErrorDetails(props: ErrorDetailsProps) {
  const raw = () => JSON.stringify(props.error, null, 2)

  return (
    <div class="error-details">
      <pre class="error-detail-pre">{raw()}</pre>
    </div>
  )
}

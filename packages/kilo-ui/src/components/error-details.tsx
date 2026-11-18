/**
 * The technical record behind an error card, for reading or copying when reporting the failure.
 * The card keeps its own message readable, so this shows the raw value the surface received.
 */
export function ErrorDetails(props: { error: unknown }) {
  return (
    <div class="error-details">
      <pre class="error-detail-pre" data-scrollable>
        {raw(props.error)}
      </pre>
    </div>
  )
}

function raw(error: unknown) {
  if (typeof error === "string") return error
  try {
    return JSON.stringify(error, null, 2) ?? String(error)
  } catch {
    return String(error)
  }
}

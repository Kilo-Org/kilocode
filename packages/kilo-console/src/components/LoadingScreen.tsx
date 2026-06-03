import { LoadingLogo } from "./LoadingLogo"

type Variant = "fullscreen" | "content"

export function LoadingScreen(props: { variant: Variant }) {
  return (
    <section
      class="console-loading"
      classList={{
        "console-loading-fullscreen": props.variant === "fullscreen",
        "console-loading-content": props.variant === "content",
      }}
      role="status"
      aria-live="polite"
      aria-label="Loading Kilo Console"
    >
      <LoadingLogo />
    </section>
  )
}

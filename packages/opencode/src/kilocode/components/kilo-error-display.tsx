import type { JSX } from "solid-js"
import type { AssistantMessage } from "@kilocode/sdk/v2"

interface KiloErrorBlockProps {
  error: NonNullable<AssistantMessage["error"]>
  fallback: JSX.Element
}

export function KiloErrorBlock(props: KiloErrorBlockProps) {
  return <>{props.fallback}</>
}

import { ComponentProps, For } from "solid-js"
import { observe, squares } from "../kilocode/spinner" // kilocode_change

export function Spinner(props: {
  class?: string
  classList?: ComponentProps<"div">["classList"]
  style?: ComponentProps<"div">["style"]
}) {
  return (
    <svg
      ref={observe /* kilocode_change */}
      {...props}
      viewBox="0 0 19 19" // kilocode_change
      data-component="spinner"
      classList={{
        ...props.classList,
        [props.class ?? ""]: !!props.class,
      }}
      fill="currentColor"
    >
      <For each={squares}>
        {(square) => (
          // kilocode_change start
          <path
            d={square.d}
            style={{
              opacity: square.outer ? 0.15 : 0.4,
              animation: `${square.outer ? "pulse-opacity-dim" : "pulse-opacity"} ${square.duration}s ease-in-out infinite`,
              "animation-fill-mode": "both",
              "animation-delay": `${square.delay}s`,
            }}
          />
          // kilocode_change end
        )}
      </For>
    </svg>
  )
}

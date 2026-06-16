import type { JSX } from "solid-js"

type Props = {
  children: JSX.Element
}

export function ConfigRoute(props: Props) {
  return <>{props.children}</>
}

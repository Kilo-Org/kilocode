import { Component, Show } from "solid-js"
import { useServer } from "../../context/server"

export const BalanceChip: Component<{ class?: string }> = (props) => {
  const server = useServer()
  const balance = () => server.profileData()?.balance?.balance

  return (
    <Show when={balance() !== undefined}>
      <span class={props.class}>${(balance() ?? 0).toFixed(2)}</span>
    </Show>
  )
}

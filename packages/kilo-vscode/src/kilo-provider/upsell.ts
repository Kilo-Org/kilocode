const KEY = "kilo.agentManagerUpsell.dismissed"

export async function handleUpsellMessage(
  type: string,
  state: { get<T>(key: string, fallback: T): T; update(key: string, value: boolean): PromiseLike<void> } | undefined,
  post: (message: { type: "agentManagerUpsellLoaded"; dismissed: boolean }) => void,
) {
  if (type !== "requestAgentManagerUpsell" && type !== "dismissAgentManagerUpsell") return false
  if (type === "dismissAgentManagerUpsell") await state?.update(KEY, true)
  // Without persisted state, fail closed rather than repeatedly promoting the card.
  post({ type: "agentManagerUpsellLoaded", dismissed: state?.get(KEY, false) ?? true })
  return true
}

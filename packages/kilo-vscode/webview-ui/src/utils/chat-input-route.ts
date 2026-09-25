// Explain Code and Add to Context land in the prompt box, which exists only in the chat.
// From History, switch to the chat and re-post so the mounted prompt box gets it.
export function routeChatInput(
  message: { type?: string },
  view: string,
  show: () => void,
  post: (message: { type?: string }) => void,
) {
  if (message.type !== "triggerTask" && message.type !== "appendChatContext") return
  if (view === "newTask") return
  show()
  post(message)
}

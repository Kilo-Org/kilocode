// Explain Code, Add to Context, New Chat with Text, and review comments land in the prompt box,
// which exists only in the chat.
// From History, switch to the chat and re-post so the mounted prompt box gets it.
// The Agent Manager uses this too, with "history" while its own History view is open.
export function routeChatInput(
  message: { type?: string },
  view: string,
  show: () => void,
  post: (message: { type?: string }) => void,
) {
  if (
    message.type !== "triggerTask" &&
    message.type !== "appendChatContext" &&
    message.type !== "appendReviewComments" &&
    message.type !== "newChatWithText"
  )
    return
  if (view === "newTask") return
  show()
  post(message)
}

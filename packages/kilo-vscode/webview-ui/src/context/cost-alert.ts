import type { ExtensionMessage, QuestionRequest, WebviewMessage } from "../types/messages"

type Alert = { sessionID: string; limit: number }

export function createCostAlertHandler(
  postMessage: (msg: WebviewMessage) => void,
  handleQuestionRequest: (request: QuestionRequest) => void,
  handleQuestionResolved: (id: string) => void,
  t: (key: string, params?: Record<string, string | number | boolean>) => string,
) {
  const costAlerts = new Map<string, Alert>()

  function handleMessage(message: ExtensionMessage): boolean {
    if (message.type === "sessionCostAlert") {
      const id = crypto.randomUUID()
      costAlerts.set(id, { sessionID: message.sessionID, limit: message.limit })
      const params = { limit: `$${message.limit.toFixed(2)}`, cost: message.cost }
      handleQuestionRequest({
        id,
        sessionID: message.sessionID,
        autoSubmit: true,
        dismissResponse: "continue",
        rejectLabel: t("session.costAlert.stop"),
        tone: "warning",
        questions: [
          {
            header: t("session.costAlert.header"),
            question: t("session.costAlert.question", params),
            options: [{ label: t("session.costAlert.continue"), description: "" }],
          },
        ],
      })
      return true
    }
    if (message.type === "sessionCostAlertResolved") {
      costAlerts.forEach((a, id) => {
        if (a.sessionID === message.sessionID && a.limit === message.limit) {
          costAlerts.delete(id)
          handleQuestionResolved(id)
        }
      })
      return true
    }
    return false
  }

  function reply(id: string, response: "continue" | "stop"): boolean {
    const alert = costAlerts.get(id)
    if (!alert) return false
    postMessage({ type: "sessionCostAlertResponse", sessionID: alert.sessionID, limit: alert.limit, response })
    return true
  }

  function close(id: string, dismiss: (id: string) => void) {
    costAlerts.has(id) ? (costAlerts.delete(id), handleQuestionResolved(id)) : dismiss(id)
  }

  return { handleMessage, reply, close }
}

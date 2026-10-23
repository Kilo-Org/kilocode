import { Component, createSignal } from "solid-js"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { Button } from "@kilocode/kilo-ui/button"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { useLanguage } from "../../context/language"
import { useSession } from "../../context/session"
import { Identifier } from "../../utils/id"
import type { HostedStartSessionMessage } from "../../types/messages"

interface HostedStartDialogProps {
  onStart: (message: HostedStartSessionMessage) => void
}

/**
 * Starts one hosted session. The operation key and initial message id are
 * minted once per dialog submission so retrying the same intent deduplicates
 * instead of creating a second session.
 */
export const HostedStartDialog: Component<HostedStartDialogProps> = (props) => {
  const language = useLanguage()
  const dialog = useDialog()
  const session = useSession()

  const selection = () => session.selected()
  const defaultModel = () => {
    const model = selection()
    return model ? `${model.providerID}/${model.modelID}` : ""
  }

  const [repository, setRepository] = createSignal("")
  const [branch, setBranch] = createSignal("")
  const [prompt, setPrompt] = createSignal("")
  const [agent, setAgent] = createSignal(session.agents()[0]?.name ?? "build")
  const [model, setModel] = createSignal(defaultModel())
  const [error, setError] = createSignal<string | undefined>(undefined)

  function submit() {
    const repo = repository().trim()
    const value = prompt().trim()
    const mode = agent().trim()
    const name = model().trim()
    if (!repo) {
      setError(language.t("hosted.repository"))
      return
    }
    if (!value) {
      setError(language.t("hosted.prompt"))
      return
    }
    if (!mode || !name) {
      setError(`${language.t("hosted.agent")} / ${language.t("hosted.model")}`)
      return
    }
    const isUrl = repo.includes("://") || repo.endsWith(".git")
    props.onStart({
      type: "hostedStartSession",
      ...(isUrl ? { repositoryType: "git" as const, url: repo } : { repositoryType: "github" as const, repo }),
      ...(branch().trim() ? { branch: branch().trim() } : {}),
      prompt: value,
      mode,
      model: name,
      operationKey: crypto.randomUUID(),
      messageID: Identifier.ascending("message"),
    })
    dialog.close()
  }

  return (
    <Dialog title={language.t("hosted.start")} fit>
      <div class="dialog-confirm-body">
        <TextField
          autofocus
          placeholder={language.t("hosted.repository")}
          value={repository()}
          onChange={setRepository}
        />
        <TextField placeholder={language.t("hosted.branch")} value={branch()} onChange={setBranch} />
        <TextField placeholder={language.t("hosted.prompt")} value={prompt()} onChange={setPrompt} />
        <TextField placeholder={language.t("hosted.agent")} value={agent()} onChange={setAgent} />
        <TextField
          placeholder={language.t("hosted.model")}
          value={model()}
          onChange={setModel}
          validationState={error() ? "invalid" : undefined}
          error={error()}
        />
        <div class="dialog-confirm-actions">
          <Button variant="secondary" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="primary" size="large" onClick={submit}>
            {language.t("hosted.start")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

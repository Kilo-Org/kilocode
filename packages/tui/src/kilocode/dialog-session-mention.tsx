import { createResource, onMount } from "solid-js"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { useProject } from "../context/project"
import { Locale } from "../util/locale"
import { fetchSessionMentions, type SessionMention } from "./session-mentions"

/**
 * Searchable past-chat picker opened from the prompt's "Past chats" @-mention
 * option. Lists recent sessions from the current worktree and fuzzy-filters
 * them by title via DialogSelect's built-in search — the same matching the
 * other session searches use — but inserts the picked session into the prompt
 * as a mention instead of navigating to it.
 */
export function DialogSessionMention(props: { exclude?: string; onPick: (session: SessionMention) => void }) {
  const dialog = useDialog()
  const sdk = useSDK()
  const project = useProject()

  const [sessions] = createResource(() => fetchSessionMentions(sdk, project.instance.directory(), "", 100), {
    initialValue: [],
  })

  onMount(() => {
    dialog.setSize("large")
  })

  const options = () =>
    sessions()
      .filter((item) => item.id !== props.exclude)
      .map((item) => ({
        title: item.title,
        value: item.id,
        description: Locale.todayTimeOrDateTime(item.updated),
      }))

  return (
    <DialogSelect
      title="Reference a past chat"
      options={options()}
      onSelect={(option) => {
        const found = sessions().find((item) => item.id === option.value)
        if (found) props.onPick(found)
        dialog.clear()
      }}
    />
  )
}

import { createSignal } from "solid-js"

export interface FileAttachmentItem {
  id: string
  path: string
  name: string
}

export function useFileAttachments() {
  const [files, setFiles] = createSignal<FileAttachmentItem[]>([])

  const add = (path: string, name: string) => {
    const exists = files().some((f) => f.path === path)
    if (exists) return
    const item: FileAttachmentItem = {
      id: crypto.randomUUID(),
      path,
      name,
    }
    setFiles((prev) => [...prev, item])
  }

  const remove = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }

  const clear = () => setFiles([])

  const replace = (next: FileAttachmentItem[]) => setFiles(next)

  return { files, add, remove, clear, replace }
}

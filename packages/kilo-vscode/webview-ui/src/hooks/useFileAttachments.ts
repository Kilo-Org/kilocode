import { createSignal } from "solid-js"
import { isAcceptedImageType } from "./image-attachments-utils"

export interface FileAttachmentItem {
  id: string
  /** Absolute filesystem path (from file picker) OR data: URL (from drag-drop) */
  url: string
  name: string
  mime: string
}

export function useFileAttachments() {
  const [files, setFiles] = createSignal<FileAttachmentItem[]>([])

  const add = (url: string, name: string, mime: string) => {
    const exists = files().some((f) => f.url === url)
    if (exists) return
    const item: FileAttachmentItem = {
      id: crypto.randomUUID(),
      url,
      name,
      mime,
    }
    setFiles((prev) => [...prev, item])
  }

  const remove = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }

  const clear = () => setFiles([])

  const replace = (next: FileAttachmentItem[]) => setFiles(next)

  /** Handle dropped files — reads non-image files as data: URLs */
  const handleDrop = (event: DragEvent) => {
    const dropped = event.dataTransfer?.files
    if (!dropped) return
    for (const file of Array.from(dropped)) {
      if (isAcceptedImageType(file.type)) continue
      if (file.size === 0 && !file.type) continue
      const reader = new FileReader()
      reader.onload = () => {
        const mime = file.type || "application/octet-stream"
        add(reader.result as string, file.name, mime)
      }
      reader.readAsDataURL(file)
    }
  }

  return { files, add, remove, clear, replace, handleDrop }
}

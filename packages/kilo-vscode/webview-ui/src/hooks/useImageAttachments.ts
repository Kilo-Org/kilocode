/** Image attachments and path drops shared by the composer prompts. */
import { createSignal } from "solid-js"
import { extractDropPaths, KILO_FILE_PATH_MIME } from "../utils/path-mentions"

export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]

export interface ImageAttachment {
  id: string
  filename: string
  mime: string
  dataUrl: string
}

export type FilePathDropHandler = (paths: string[]) => void

function accepted(mime: string) {
  return ACCEPTED_IMAGE_TYPES.includes(mime)
}

function leaving(related: EventTarget | null, current: HTMLElement) {
  if (!related) return true
  return !current.contains(related as Node)
}

export function useImageAttachments() {
  const [images, setImages] = createSignal<ImageAttachment[]>([])
  const [dragging, setDragging] = createSignal(false)
  const [pending, setPending] = createSignal(0)
  let onFilePaths: FilePathDropHandler | undefined

  const setFilePathDropHandler = (handler: FilePathDropHandler) => {
    onFilePaths = handler
  }

  const add = (file: File) => {
    if (!accepted(file.type)) return
    const reader = new FileReader()
    setPending((count) => count + 1)
    reader.onloadend = () => setPending((count) => count - 1)
    reader.onload = () => {
      setImages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          filename: file.name || "image",
          mime: file.type,
          dataUrl: reader.result as string,
        },
      ])
    }
    reader.readAsDataURL(file)
  }

  const addPaths = (paths: string[]) => onFilePaths?.(paths)

  const handlePaste = (event: ClipboardEvent) => {
    const data = event.clipboardData
    if (!data) return
    let handled = false
    for (const item of data.items) {
      if (item.kind !== "file") continue
      const file = item.getAsFile()
      if (!file) continue
      if (accepted(file.type)) {
        add(file)
        handled = true
        continue
      }
      const paths = extractDropPaths(data)
      if (paths) {
        addPaths(paths)
        handled = true
      }
    }
    if (handled) event.preventDefault()
  }

  const handleDragOver = (event: DragEvent) => {
    if (!event.dataTransfer) return
    const types = [...event.dataTransfer.types]
    if (!types.some((type) => type === KILO_FILE_PATH_MIME || type === "Files" || type === "application/vnd.code.uri-list"))
      return
    event.preventDefault()
    setDragging(true)
  }

  const handleDragLeave = (event: DragEvent) => {
    if (!leaving(event.relatedTarget, event.currentTarget as HTMLElement)) return
    setDragging(false)
  }

  const handleDrop = (event: DragEvent) => {
    if (!event.dataTransfer) return
    event.preventDefault()
    setDragging(false)
    const paths = extractDropPaths(event.dataTransfer)
    if (paths) {
      addPaths(paths)
      return
    }
    for (const file of event.dataTransfer.files) add(file)
  }

  const remove = (id: string) => setImages((prev) => prev.filter((image) => image.id !== id))
  const clear = () => setImages([])
  const replace = (value: ImageAttachment[]) => setImages(value)

  return {
    images,
    dragging,
    pending,
    setFilePathDropHandler,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    add,
    remove,
    clear,
    replace,
  }
}

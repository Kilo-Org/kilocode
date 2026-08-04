import { createSignal } from "solid-js"
import { ACCEPTED_IMAGE_TYPES, isAcceptedImageType, isDragLeavingComponent } from "./image-attachments-utils"
import { extractDropPaths, KILO_FILE_PATH_MIME } from "../utils/path-mentions"

export interface ImageAttachment {
  id: string
  filename: string
  mime: string
  dataUrl: string
}

/** Callback for handling text/URI file path drops. */
export type FilePathDropHandler = (paths: string[]) => void

/** Callback when dropped files are not images and no path mention was extracted. */
export type UnsupportedDropHandler = () => void

export function useImageAttachments() {
  const [images, setImages] = createSignal<ImageAttachment[]>([])
  const [dragging, setDragging] = createSignal(false)
  let onFilePaths: FilePathDropHandler | undefined
  let onUnsupportedDrop: UnsupportedDropHandler | undefined

  /** Register a handler for file path drops (text/URI-list). */
  const setFilePathDropHandler = (handler: FilePathDropHandler) => {
    onFilePaths = handler
  }

  /** Register a handler for unsupported file drops (non-image OS drags without a URI list). */
  const setUnsupportedDropHandler = (handler: UnsupportedDropHandler) => {
    onUnsupportedDrop = handler
  }

  const add = (file: File) => {
    if (!isAcceptedImageType(file.type)) return
    const reader = new FileReader()
    reader.onload = () => {
      const attachment: ImageAttachment = {
        id: crypto.randomUUID(),
        filename: file.name || "image",
        mime: file.type,
        dataUrl: reader.result as string,
      }
      setImages((prev) => [...prev, attachment])
    }
    reader.readAsDataURL(file)
  }

  const remove = (id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id))
  }

  const clear = () => setImages([])

  const replace = (next: ImageAttachment[]) => setImages(next)

  const handlePaste = (event: ClipboardEvent) => {
    const items = Array.from(event.clipboardData?.items ?? [])
    const imageItems = items.filter((item) => item.kind === "file" && ACCEPTED_IMAGE_TYPES.includes(item.type))
    if (imageItems.length === 0) return
    event.preventDefault()
    for (const item of imageItems) {
      const file = item.getAsFile()
      if (file) add(file)
    }
  }

  const handleDragOver = (event: DragEvent) => {
    const types = event.dataTransfer?.types
    if (!types) return
    // Accept file drops, VS Code URI-list drops, and internal file-path drags.
    // Do NOT accept bare text/plain here — that would intercept normal text drags.
    const acceptable =
      types.includes("Files") ||
      types.includes("application/vnd.code.uri-list") ||
      types.includes("text/uri-list") ||
      types.includes(KILO_FILE_PATH_MIME)
    if (!acceptable) return
    event.preventDefault()
    setDragging(true)
  }

  const handleDragLeave = (event: DragEvent) => {
    if (isDragLeavingComponent(event.relatedTarget, event.currentTarget as HTMLElement)) {
      setDragging(false)
    }
  }

  const handleDrop = (event: DragEvent) => {
    setDragging(false)
    event.preventDefault()
    const dt = event.dataTransfer
    if (!dt) return

    // First: check for text/URI file path drops (VS Code explorer, editor tabs)
    const paths = extractDropPaths(dt)
    if (paths && paths.length > 0 && onFilePaths) {
      onFilePaths(paths)
      return
    }

    // Second: fall through to image file drops
    const files = dt.files
    if (!files || files.length === 0) return

    let added = false
    for (const file of Array.from(files)) {
      if (!isAcceptedImageType(file.type)) continue
      add(file)
      added = true
    }
    if (!added && onUnsupportedDrop) onUnsupportedDrop()
  }

  return {
    images,
    dragging,
    add,
    remove,
    clear,
    replace,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    setFilePathDropHandler,
    setUnsupportedDropHandler,
  }
}

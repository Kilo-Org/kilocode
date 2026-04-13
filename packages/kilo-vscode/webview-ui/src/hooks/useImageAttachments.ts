import { createSignal, type Accessor } from "solid-js"
import { ACCEPTED_IMAGE_TYPES, isAcceptedImageType, isDragLeavingComponent } from "./image-attachments-utils"
import { extractDropPaths } from "../utils/path-mentions"

export interface ImageAttachment {
  id: string
  filename: string
  mime: string
  dataUrl: string
}

/** Callback for handling text/URI file path drops. */
export type FilePathDropHandler = (paths: string[]) => void

export interface UseImageAttachmentsOptions {
  imageMode?: Accessor<"data" | "path">
}

export function useImageAttachments(options: UseImageAttachmentsOptions = {}) {
  const [images, setImages] = createSignal<ImageAttachment[]>([])
  const [dragging, setDragging] = createSignal(false)
  let onFilePaths: FilePathDropHandler | undefined

  const getMode = () => options.imageMode?.() ?? "data"

  const add = (file: File) => {
    if (!isAcceptedImageType(file.type)) return
    const mode = getMode()
    if (mode === "path") {
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        const base64 = dataUrl.split(",")[1]
        if (!base64) return
        const id = crypto.randomUUID()
        window.vscode?.postMessage({
          type: "saveImageToTemp",
          id,
          mime: file.type || "image/png",
          base64,
          filename: file.name || "image.png",
        })
      }
      reader.readAsDataURL(file)
      return
    }
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

  /** Register a handler for file path drops (text/URI-list). */
  const setFilePathDropHandler = (handler: FilePathDropHandler) => {
    onFilePaths = handler
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
    const acceptable = types.includes("Files") || types.includes("application/vnd.code.uri-list")
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

    const paths = extractDropPaths(dt)
    if (paths && paths.length > 0 && onFilePaths) {
      onFilePaths(paths)
      return
    }

    const files = dt.files
    if (!files) return
    for (const file of Array.from(files)) add(file)
  }

  const handleImageSaved = (id: string, filePath: string) => {
    const attachment: ImageAttachment = {
      id,
      filename: filePath.split("/").pop() || "image",
      mime: "image/png",
      dataUrl: `file://${filePath}`,
    }
    setImages((prev) => [...prev, attachment])
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
    handleImageSaved,
  }
}

import { createSignal } from "solid-js"
import { showToast } from "@kilocode/kilo-ui/toast"
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_TEXT_BYTES,
  isAcceptedImageType,
  isDragLeavingComponent,
  textDataUrl,
} from "./image-attachments-utils"
import { extractDropPaths, KILO_FILE_PATH_MIME } from "../utils/path-mentions"
import { useLanguage } from "../context/language"

/** An attached image, or a dropped text file with mime "text/plain". */
export interface ImageAttachment {
  id: string
  filename: string
  mime: string
  dataUrl: string
}

/** Callback for handling text/URI file path drops. */
export type FilePathDropHandler = (paths: string[]) => void

export function useImageAttachments() {
  const language = useLanguage()
  const [images, setImages] = createSignal<ImageAttachment[]>([])
  const [dragging, setDragging] = createSignal(false)
  const [pending, setPending] = createSignal(0)
  let onFilePaths: FilePathDropHandler | undefined

  /** Register a handler for file path drops (text/URI-list). */
  const setFilePathDropHandler = (handler: FilePathDropHandler) => {
    onFilePaths = handler
  }

  const push = (filename: string, mime: string, dataUrl: string) =>
    setImages((prev) => [...prev, { id: crypto.randomUUID(), filename, mime, dataUrl }])

  const add = (file: File) => {
    if (!isAcceptedImageType(file.type)) return
    const reader = new FileReader()
    setPending((count) => count + 1)
    reader.onloadend = () => setPending((count) => count - 1)
    reader.onload = () => push(file.name || "image", file.type, reader.result as string)
    reader.readAsDataURL(file)
  }

  /** Attach a dropped non-image file as text, or tell the user why it cannot be attached. */
  const attach = async (file: File) => {
    const reject = (key: string) =>
      showToast({
        variant: "error",
        title: language.t("prompt.attachment.failed"),
        description: language.t(key, { name: file.name, size: `${MAX_TEXT_BYTES / 1024} KB` }),
      })
    if (file.size > MAX_TEXT_BYTES) return reject("prompt.attachment.tooLarge")
    setPending((count) => count + 1)
    // A folder dropped from the OS cannot be read, so it is rejected below.
    const bytes = await file.arrayBuffer().then(
      (buf) => new Uint8Array(buf),
      (err: unknown) => console.warn("[Kilo New] Cannot read dropped file:", file.name, err),
    )
    setPending((count) => count - 1)
    const url = bytes ? textDataUrl(bytes) : undefined
    if (!url) return reject("prompt.attachment.unsupported")
    push(file.name || "file", "text/plain", url)
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
      types.includes("Files") || types.includes("application/vnd.code.uri-list") || types.includes(KILO_FILE_PATH_MIME)
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

    // Second: OS file drops (for example from Finder) give the webview the file
    // contents but not the path. Attach images as images and other files as text.
    const files = dt.files
    if (!files) return
    for (const file of Array.from(files)) {
      if (isAcceptedImageType(file.type)) add(file)
      else void attach(file)
    }
  }

  return {
    images,
    dragging,
    pending: () => pending() > 0,
    add,
    remove,
    clear,
    replace,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    setFilePathDropHandler,
  }
}

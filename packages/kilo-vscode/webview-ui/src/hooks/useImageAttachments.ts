import { createSignal } from "solid-js"

export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]

export interface ImageAttachment {
  id: string
  filename: string
  mime: string
  dataUrl: string
}

export function useImageAttachments() {
  const [images, setImages] = createSignal<ImageAttachment[]>([])
  const [dragging, setDragging] = createSignal(false)

  const add = (file: File) => {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return
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
    const hasFiles = event.dataTransfer?.types.includes("Files")
    if (!hasFiles) return
    event.preventDefault()
    setDragging(true)
  }

  const handleDragLeave = (event: DragEvent) => {
    if (!event.relatedTarget || !(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node)) {
      setDragging(false)
    }
  }

  const handleDrop = (event: DragEvent) => {
    setDragging(false)
    event.preventDefault()
    const files = event.dataTransfer?.files
    if (!files) return
    for (const file of Array.from(files)) add(file)
  }

  return {
    images,
    dragging,
    add,
    remove,
    clear,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  }
}

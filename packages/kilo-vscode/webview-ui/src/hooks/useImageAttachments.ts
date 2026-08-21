import { createSignal } from "solid-js"
import {
  ACCEPTED_IMAGE_TYPES,
  getBase64ByteLength,
  getImageDimensions,
  IMAGE_MAX_BASE64_BYTES,
  isAcceptedImageType,
  isDragLeavingComponent,
  isStaticImageType,
} from "./image-attachments-utils"
import { extractDropPaths, KILO_FILE_PATH_MIME } from "../utils/path-mentions"

export interface ImageAttachment {
  id: string
  filename: string
  mime: string
  dataUrl: string
}

/** Callback for handling text/URI file path drops. */
export type FilePathDropHandler = (paths: string[]) => void

const JPEG_QUALITIES = [0.85, 0.8, 0.7, 0.55, 0.4]

interface ImageSource {
  blob: Blob
  mime: string
}

interface EncodedImage {
  blob: Blob
  mime: string
}

function toBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Image encoding failed"))
          return
        }
        resolve(blob)
      },
      mime,
      quality,
    )
  })
}

function isOpaque(ctx: CanvasRenderingContext2D): boolean {
  const pixels = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] !== 255) return false
  }
  return true
}

async function normalizeImage(file: File): Promise<ImageSource> {
  if (!isStaticImageType(file.type)) return { blob: file, mime: file.type }
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    return { blob: file, mime: file.type }
  }

  const bitmap = await createImageBitmap(file)
  let canvas: HTMLCanvasElement | undefined
  try {
    const size = getImageDimensions(bitmap.width, bitmap.height)
    if (
      size.width === bitmap.width &&
      size.height === bitmap.height &&
      getBase64ByteLength(file.size) <= IMAGE_MAX_BASE64_BYTES
    ) {
      return { blob: file, mime: file.type }
    }

    const node = document.createElement("canvas")
    canvas = node
    if (typeof node.toBlob !== "function") return { blob: file, mime: file.type }

    const draw = (next: { width: number; height: number }) => {
      node.width = next.width
      node.height = next.height
      const ctx = node.getContext("2d")
      if (!ctx) throw new Error("Canvas context unavailable")
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = "high"
      ctx.drawImage(bitmap, 0, 0, next.width, next.height)
      return ctx
    }

    const encode = async (next: { width: number; height: number }, mime: string, qualities: (number | undefined)[]) => {
      draw(next)
      let last: EncodedImage | undefined
      for (const quality of qualities) {
        const blob = await toBlob(node, mime, quality)
        last = { blob, mime: blob.type || mime }
        if (getBase64ByteLength(blob.size) <= IMAGE_MAX_BASE64_BYTES) return last
      }
      return last
    }

    const shrink = async (mime: string, qualities: (number | undefined)[]) => {
      let next = size
      for (let attempt = 0; attempt < 8; attempt++) {
        const image = await encode(next, mime, qualities)
        if (image && getBase64ByteLength(image.blob.size) <= IMAGE_MAX_BASE64_BYTES) return image
        const bytes = image ? getBase64ByteLength(image.blob.size) : IMAGE_MAX_BASE64_BYTES
        const scale = Math.min(0.9, Math.max(0.5, Math.sqrt(IMAGE_MAX_BASE64_BYTES / bytes) * 0.9))
        const smaller = getImageDimensions(
          Math.max(1, Math.floor(next.width * scale)),
          Math.max(1, Math.floor(next.height * scale)),
        )
        if (smaller.width === next.width && smaller.height === next.height) return undefined
        next = smaller
      }
      return undefined
    }

    const primary = await encode(size, file.type, file.type === "image/png" ? [undefined] : JPEG_QUALITIES)
    if (primary && getBase64ByteLength(primary.blob.size) <= IMAGE_MAX_BASE64_BYTES) return primary

    if (file.type !== "image/jpeg" && isOpaque(draw(size))) {
      const jpeg = await shrink("image/jpeg", JPEG_QUALITIES)
      if (jpeg) return jpeg
    }

    const resized = await shrink(file.type, file.type === "image/png" ? [undefined] : JPEG_QUALITIES)
    if (resized) return resized
    return { blob: file, mime: file.type }
  } finally {
    bitmap.close()
    if (canvas) {
      canvas.width = 0
      canvas.height = 0
    }
  }
}

export function useImageAttachments() {
  const [images, setImages] = createSignal<ImageAttachment[]>([])
  const [dragging, setDragging] = createSignal(false)
  let onFilePaths: FilePathDropHandler | undefined

  /** Register a handler for file path drops (text/URI-list). */
  const setFilePathDropHandler = (handler: FilePathDropHandler) => {
    onFilePaths = handler
  }

  const add = (file: File) => {
    if (!isAcceptedImageType(file.type)) return
    void normalizeImage(file)
      .catch(() => ({ blob: file, mime: file.type }))
      .then((source) => {
        const reader = new FileReader()
        reader.onload = () => {
          if (typeof reader.result !== "string") return
          const attachment: ImageAttachment = {
            id: crypto.randomUUID(),
            filename: file.name || "image",
            mime: source.mime,
            dataUrl: reader.result,
          }
          setImages((prev) => [...prev, attachment])
        }
        reader.readAsDataURL(source.blob)
      })
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

    // Second: fall through to image file drops
    const files = dt.files
    if (!files) return
    for (const file of Array.from(files)) add(file)
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
  }
}

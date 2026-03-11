const ext = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "ico",
  "webp",
  "avif",
  "tiff",
  "tif",
  "apng",
  "jxl",
  "heic",
  "heif",
  "raw",
  "cr2",
  "nef",
  "arw",
  "dng",
  "orf",
  "raf",
  "pef",
  "x3f",
  "mp3",
  "mp4",
  "wav",
  "ogg",
  "oga",
  "ogv",
  "ogx",
  "webm",
  "flac",
  "aac",
  "m4a",
  "weba",
  "mov",
  "avi",
  "wmv",
  "flv",
  "mkv",
  "zip",
  "gz",
  "gzip",
  "tar",
  "bz",
  "bz2",
  "7z",
  "rar",
  "xz",
  "lz",
  "z",
  "zst",
  "dmg",
  "iso",
  "img",
  "vmdk",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "exe",
  "dll",
  "so",
  "dylib",
  "bin",
  "dat",
  "wasm",
  "node",
  "class",
  "jar",
  "war",
  "ear",
  "sqlite",
  "db",
  "mdb",
])

export namespace BinaryFile {
  export function isPath(file: string) {
    const slash = Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\"))
    const name = file.slice(slash + 1)
    const dot = name.lastIndexOf(".")
    if (dot === -1) return false
    const value = name.slice(dot + 1).toLowerCase()
    if (!value) return false
    return ext.has(value)
  }

  export function isNumstat(additions: string | undefined, deletions: string | undefined, file: string) {
    if (additions === "-" && deletions === "-") return true
    return isPath(file)
  }

  export function isDiff(diff: { file: string; binary?: boolean }) {
    if (diff.binary === true) return true
    return isPath(diff.file)
  }
}

export function redact(msg: string): string {
  if (!msg || typeof msg !== "string") return String(msg)
  let s = msg
  s = s.replace(
    /(?:https?|ftp|file):\/\/(?:localhost|[\w\-\.]+)(?::\d+)?(?:\/[\w\-\.\/\?\&\=\#]*)?/gi,
    "[URL]",
  )
  s = s.replace(/[\w\-\.]+@[\w\-\.]+\.\w+/g, "[EMAIL]")
  s = s.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[IP]")
  s = s.replace(/"[^"]*(?:\/|\\)[^"]*"/g, '"[PATH]"')
  s = s.replace(
    /(?:\/[\w\-\.]+)+(?:\/[\w\-\.\s]*)*|(?:[A-Za-z]:\\[\w\-\.\\]+)|(?:\.{1,2}\/[\w\-\.\/]+)/g,
    "[PATH]",
  )
  s = s.replace(/(?<!URL\]):(\d{2,5})\b/g, ":[PORT]")
  return s
}

export function args(command: string) {
  return ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script(command)]
}

const setup = `[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false);
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false);
$OutputEncoding = [Console]::OutputEncoding;
`

function script(command: string) {
  const pos = prologue(command)
  const head = command.slice(0, pos)
  const body = command.slice(pos)
  const gap = head && !/[;\r\n]\s*$/.test(head) ? "\n" : ""
  return `${head}${gap}${setup}${body}`
}

function prologue(command: string) {
  const pos = scan(command, 0)
  const attr = attrs(command, pos)
  const body = command.slice(attr)
  const match = /^param\s*\(/i.exec(body)
  if (!match) return pos

  const start = attr + match[0].lastIndexOf("(")
  const end = block(command, start, "(", ")")
  if (end === undefined) return pos
  return end
}

function attrs(command: string, start: number) {
  let pos = start
  while (pos < command.length) {
    const next = scan(command, pos)
    if (command[next] !== "[") return next
    const end = block(command, next, "[", "]")
    if (end === undefined) return start
    pos = end
  }
  return pos
}

function scan(command: string, start: number) {
  let pos = start
  while (pos < command.length) {
    const next = trivia(command, pos)
    if (next !== pos) {
      pos = next
      continue
    }
    const end = line(command, pos)
    const value = command.slice(pos, end)
    if (/^using\s+(?:assembly|module|namespace|type)\b/i.test(value)) {
      pos = end
      continue
    }
    return pos
  }
  return pos
}

function trivia(command: string, start: number) {
  let pos = start
  while (pos < command.length) {
    while (/\s/.test(command[pos] ?? "")) pos++
    if (command[pos] === "#") {
      pos = line(command, pos)
      continue
    }
    if (command.startsWith("<#", pos)) {
      const end = command.indexOf("#>", pos + 2)
      if (end === -1) return command.length
      pos = end + 2
      continue
    }
    return pos
  }
  return pos
}

function line(command: string, start: number) {
  const index = command.indexOf("\n", start)
  if (index === -1) return command.length
  return index + 1
}

function block(command: string, start: number, open: string, close: string) {
  let depth = 0
  let quote: string | undefined
  for (let pos = start; pos < command.length; pos++) {
    const char = command[pos]
    if (quote) {
      if (quote === "'" && char === "'" && command[pos + 1] === "'") {
        pos++
        continue
      }
      if (quote === '"' && char === "`") {
        pos++
        continue
      }
      if (char === quote) quote = undefined
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (command.startsWith("<#", pos)) {
      const end = command.indexOf("#>", pos + 2)
      if (end === -1) return
      pos = end + 1
      continue
    }
    if (char === "#") {
      pos = line(command, pos) - 1
      continue
    }
    if (char === open) depth++
    if (char === close) {
      depth--
      if (depth === 0) return pos + 1
    }
  }
}

export const PowerShell = { args }

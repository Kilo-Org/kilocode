/** A deliberately finite shell grammar. Unsupported syntax stays opaque. */
export function segments(command: string): string[] {
  const result: string[] = []
  let text = ""
  let quote = ""
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    if (ch === "\\" && quote !== "'") {
      text += ch + (command[++i] ?? "")
      continue
    }
    if (quote) {
      text += ch
      if (ch === quote) quote = ""
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      text += ch
      continue
    }
    if (ch === "#" && (!text || /\s$/.test(text))) {
      while (i < command.length && command[i] !== "\n") i++
      if (text.trim()) result.push(text.trim())
      text = ""
      continue
    }
    if (ch === ";" || ch === "\n" || ch === "|" || (ch === "&" && command[i + 1] === "&")) {
      if (text.trim()) result.push(text.trim())
      text = ""
      if ((ch === "|" || ch === "&") && command[i + 1] === ch) i++
      continue
    }
    text += ch
  }
  if (text.trim()) result.push(text.trim())
  return result
}

export function tokens(segment: string): string[] {
  const result: string[] = []
  let text = ""
  let quote = ""
  let started = false
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]
    if (ch === "\\" && quote !== "'") {
      if (i + 1 >= segment.length) throw new Error("unterminated_escape")
      text += segment[++i]
      started = true
      continue
    }
    if (quote) {
      if (ch === quote) quote = ""
      else text += ch
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      started = true
      continue
    }
    if (/\s/.test(ch)) {
      if (started) result.push(text)
      text = ""
      started = false
      continue
    }
    text += ch
    started = true
  }
  if (quote) throw new Error("unterminated_quote")
  if (started) result.push(text)
  return result
}

export function opaque(command: string): boolean {
  // Even quoted expansions are conservatively excluded; no shell evaluation here.
  return /[$`<>\u0000]|(?:^|[^&])&(?:[^&]|$)|[{}()]|\\\n/.test(command)
}

export interface Arguments {
  targets: string[]
  options: Record<string, unknown>
}

/** Consume option values as values, not paths. Unlisted flags never gain fast allow. */
export function testArguments(argv: string[], cwd: string): Arguments | undefined {
  const direct = /^(pytest|py\.test)$/.test(argv[0] ?? "")
  const module = /^python3?$/.test(argv[0] ?? "") && argv[1] === "-m" && /^(pytest|unittest)$/.test(argv[2] ?? "")
  if (!direct && !module) return
  const runner = direct ? "pytest" : argv[2]
  const rest = argv.slice(direct ? 1 : 3)
  const targets: string[] = []
  const options: Record<string, unknown> = { runner, argv, cwd }
  let positional = false
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]
    if (token === "--") {
      positional = true
      continue
    }
    if (!positional && token.startsWith("-")) {
      if (runner === "pytest") {
        if (
          /^-[qvxsf]+$/.test(token) ||
          /^(--quiet|--verbose|--exitfirst|--disable-warnings|--collect-only)$/.test(token)
        )
          continue
        const match = token.match(/^(--maxfail|--tb|--color|--capture)(?:=(.*))?$/)
        if (match) {
          const value = match[2] ?? rest[++i]
          const valid =
            match[1] === "--maxfail"
              ? /^\d+$/.test(value ?? "")
              : match[1] === "--tb"
                ? /^(auto|long|short|line|native|no)$/.test(value ?? "")
                : match[1] === "--color"
                  ? /^(yes|no|auto)$/.test(value ?? "")
                  : /^(fd|sys|no|tee-sys)$/.test(value ?? "")
          if (!valid) return
          options[match[1]] = value
          continue
        }
        if (/^-[km]/.test(token)) {
          const value = token.length > 2 ? token.slice(2) : rest[++i]
          if (!value || value.startsWith("-")) return
          options[token.slice(0, 2)] = value
          continue
        }
        return
      }
      if (/^-[vqfb]+$/.test(token) || /^(--verbose|--quiet|--failfast|--buffer)$/.test(token)) continue
      const match = token.match(/^(--start-directory|--top-level-directory|--pattern)(?:=(.*))?$|^(-[stp])(.*)$/)
      if (!match) return
      const flag = match[1] ?? match[3]
      const value = match[2] ?? (match[4] || rest[++i])
      if (!value || value.startsWith("-")) return
      if (flag === "-p" || flag === "--pattern") options.pattern = value
      else targets.push(value)
      continue
    }
    if (runner === "unittest" && token === "discover") continue
    // Dotted unittest module names cannot be resolved as filesystem targets cheaply.
    if (runner === "unittest" && !token.includes("/") && !token.endsWith(".py")) return
    if (/[*?\[\]~]/.test(token)) return
    targets.push(token.split("::")[0])
  }
  return {
    targets: targets.length ? targets : [cwd],
    options: { ...options, default_collection: targets.length === 0 },
  }
}

export function readArguments(argv: string[]): Arguments | undefined {
  const verb = argv[0]
  const targets: string[] = []
  const options: Record<string, unknown> = {}
  let pattern = false
  let positional = false
  for (let i = 1; i < argv.length; i++) {
    const token = argv[i]
    if (!positional && token === "--") {
      positional = true
      continue
    }
    if (!positional && token.startsWith("-")) {
      const safe =
        verb === "cat"
          ? /^-[nbsvETA]+$|^--(number|squeeze-blank|show-all)$/
          : verb === "ls"
            ? /^-[laAhRrSt1dF]+$|^--(all|almost-all|directory)$/
            : /^(head|tail)$/.test(verb)
              ? /^-[qv]+$/
              : verb === "wc"
                ? /^-[lwmcL]+$/
                : verb === "rg"
                  ? /^-[nliIvwchFS]+$|^--(files|hidden|no-ignore|line-number|count|files-with-matches|fixed-strings)$/
                  : verb === "grep"
                    ? /^-[nliIvwchFrR]+$/
                    : /$a/
      if (safe.test(token)) {
        if (token === "--files") pattern = true
        continue
      }
      if (/^(head|tail)$/.test(verb) && /^-[nc]\d+$/.test(token)) continue
      if (/^(head|tail)$/.test(verb) && /^-[nc]$/.test(token) && /^\d+$/.test(argv[i + 1] ?? "")) {
        i++
        continue
      }
      if (verb === "rg" && /^(--glob|-g|--type|-t)$/.test(token) && argv[i + 1]) {
        options[token] = argv[++i]
        continue
      }
      if (/^(rg|grep)$/.test(verb) && /^(--regexp|-e)$/.test(token) && argv[i + 1]) {
        options.pattern = argv[++i]
        pattern = true
        continue
      }
      return
    }
    if (/^(rg|grep)$/.test(verb) && !pattern) {
      options.pattern = token
      pattern = true
      continue
    }
    if (/[*?\[\]~]/.test(token)) return
    targets.push(token)
  }
  if (!targets.length && !/^(ls|rg|grep)$/.test(verb)) return
  return { targets: targets.length ? targets : ["."], options }
}

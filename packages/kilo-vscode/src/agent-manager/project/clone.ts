/**
 * Validate a repository URL without rewriting Git's SSH aliases or scp-style
 * path semantics. Returns `undefined` when the value is safe to pass to
 * `git.clone`, or a short human-readable reason when it is not.
 *
 * Accepted: `https://`, `ssh://`, `git://`, and scp-style `[user@]host:path`
 * values, including bracketed IPv6 hosts. Rejected: empty input, whitespace or
 * control characters, a leading dash, local paths and `file:` URLs, `ext::`
 * transports, backslashes, query strings or fragments, unsupported or host-less
 * schemes, option-like hostnames, and embedded credentials.
 */
export function validateCloneUrl(value: string): string | undefined {
  if (!value) return "Enter a repository URL."
  if (/\p{Cc}|\s/u.test(value) || value.startsWith("-")) {
    return "Repository URLs cannot contain whitespace, control characters, or start with a dash."
  }
  if (/^(?:[a-z]:|[./~\\]|file:)/i.test(value)) {
    return "Use Open local folder to add a local repository."
  }
  const invalid = "Use an HTTPS, SSH, Git, or scp-style repository URL. For local repositories, use Open local folder."
  if (/^ext::/i.test(value)) return invalid
  if (value.includes("\\")) return invalid
  if (/[?#]/.test(value)) return "Repository URLs cannot contain query parameters or fragments."
  if (!value.includes("://")) {
    return /^(?:[a-z0-9_][a-z0-9_.-]*@)?(?:[a-z0-9_][a-z0-9_.-]*|\[[a-f0-9:]+\]):[^\s@]+$/i.test(value)
      ? undefined
      : invalid
  }
  // `URL.parse` returns null for malformed input instead of throwing, which is why
  // this uses the static parser rather than `new URL` and needs no try/catch.
  const url = URL.parse(value)
  if (
    !url ||
    !["https:", "ssh:", "git:"].includes(url.protocol) ||
    !url.hostname ||
    url.hostname.startsWith("-") ||
    url.pathname.length < 2
  ) {
    return invalid
  }
  if (url.password || (url.username && url.protocol !== "ssh:") || /%3a|%40/i.test(url.username)) {
    return "Remove embedded credentials from the URL. Use your Git credential helper or SSH agent."
  }
  return undefined
}

/** Folder name Git would clone into, used to spot an existing checkout. */
export function repoName(url: string): string | undefined {
  const path = url
    .trim()
    .replace(/[?#].*$/, "")
    .replace(/[\\/]+$/, "")
  const name = path
    .split(/[\\/:]/)
    .filter(Boolean)
    .at(-1)
    ?.replace(/\.git$/i, "")
  return name && name !== "." && name !== ".." ? name : undefined
}

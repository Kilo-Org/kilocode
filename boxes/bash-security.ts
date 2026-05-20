/**
 * bash-security.ts — 23-item shell command security validator
 * Deps: none (pure TS + regex)
 * Ported from Claude Code bashSecurity.ts
 */

const BLOCKED = new Set([
  "dd", "shred", "wipefs", "sudo", "su", "pkexec", "gksudo", "kdesudo",
  "sudoedit", "keylogger", "insmod", "rmmod", "modprobe",
])
const BLOCKED_PREFIXES = ["mkfs"]
const DANGEROUS = new Set([
  "rm", "rmdir", "format", "del", "erase", "remove-item", "rd",
  "kill", "killall", "pkill", "taskkill",
  "curl", "wget", "nc", "ncat", "socat",
  "npm", "npx", "pip", "pip3", "gem", "cargo", "go",
  "docker", "aws", "gcloud", "az",
])

const INJECTION = [
  /;\s*(rm|sudo|mkfs|dd|shred|format|del)\b/i,
  /&&\s*(rm|sudo|mkfs|dd|shred|format|del)\b/i,
  /\|\s*(rm|sudo|mkfs|dd|shred|format|del)\b/i,
  /\$\([^)]*\)/, /`[^`]*`/, />\s*\/dev\//i,
  /chmod\s+777/i, /chmod\s+[+-].*s/i, /chown\s+.*root/i,
  /\\x[0-9a-f]{2}/i, /\\u[0-9a-f]{4}/i, /\\[0-7]{3}/, /\$'\x/,
  />\s*\/etc\/passwd/i, />\s*\/etc\/shadow/i,
  /cat\s+\/etc\/shadow/i, /cat\s+\/etc\/passwd.*>/i,
]
const TRAVERSAL = [/\.\.[\\/]/, /\.\.[\\/]|\.\.$/]
const EXFIL = [
  /curl.*\$\{?HOME/i, /curl.*\$HOME/i, /wget.*\$HOME/i,
  /curl.*\$\{?AWS/i, /curl.*\$\{?API_KEY/i, /curl.*\$\{?SECRET/i,
  /curl.*\$\{?TOKEN/i, /curl.*\$\{?PASSWORD/i,
  /echo.*\$.*\|.*nc/i, /echo.*\$.*\|.*curl/i,
]
const SHELL_ATK = [
  /exec\s+rm/i, /eval\s+.*rm/i, /\bsource\s+\/dev\//i, /\.\s+\/dev\//i,
  /unset\s+PATH/i, /PATH\s*=\s*""/i, /export\s+PATH\s*=\s*""/i, /\bsudoedit\b/i,
]

export interface SecurityResult {
  safe: boolean
  blocked: boolean
  reasons: string[]
  risk: "low" | "medium" | "high" | "critical"
}

function baseCmd(cmd: string): string {
  const m = cmd.trim().match(/^([A-Za-z_.\-/][A-Za-z0-9_.\-/]*)/)
  if (!m) return cmd.trim().split(/\s+/)[0]?.toLowerCase() ?? ""
  const parts = m[1].split("/")
  return parts[parts.length - 1].toLowerCase()
}

function pipedDestructive(cmd: string): boolean {
  return cmd.split(/[|;&]/).some(p => {
    const b = baseCmd(p)
    if (BLOCKED.has(b)) return true
    return BLOCKED_PREFIXES.some(pre => b.startsWith(pre + ".") || b === pre)
  })
}

function sensitivePath(t: string): boolean {
  const paths = [
    "/etc/passwd", "/etc/shadow", "/etc/ssh", "/root/.ssh", "/.ssh",
    "\\ssh", "/boot/", "\\boot\\", "/efi/", "\\efi\\",
    "/proc/sys/", "/sys/", "\\sys\\", "/dev/", "\\dev\\",
    "C:\\Windows\\System32", "C:\\Windows\\SysWOW64",
  ]
  const lower = t.toLowerCase()
  return paths.some(s => lower.includes(s.toLowerCase()))
}

function matchPats(cmd: string, pats: RegExp[], label: string, reasons: string[]): boolean {
  return pats.some(p => { if (p.test(cmd)) { reasons.push(`${label}: matched ${p.source}`); return true }; return false })
}

export function validate(command: string): SecurityResult {
  const reasons: string[] = []
  let risk: SecurityResult["risk"] = "low"
  const base = baseCmd(command)

  if (BLOCKED.has(base))
    return { safe: false, blocked: true, reasons: [`Blocked command: "${base}" is not allowed`], risk: "critical" }
  for (const pre of BLOCKED_PREFIXES)
    if (base.startsWith(pre + ".") || base === pre)
      return { safe: false, blocked: true, reasons: [`Blocked command: "${base}" matches blocked prefix "${pre}"`], risk: "critical" }
  if (pipedDestructive(command))
    return { safe: false, blocked: true, reasons: ["Destructive command detected in pipe/chain"], risk: "critical" }
  if (matchPats(command, INJECTION, "Potential injection", reasons)) risk = "high"
  if (matchPats(command, SHELL_ATK, "Shell attack vector", reasons)) risk = "high"
  if (matchPats(command, EXFIL, "Credential exfiltration", reasons)) risk = "critical"
  if (DANGEROUS.has(base) && TRAVERSAL.some(p => p.test(command))) { reasons.push("Path traversal in destructive command context"); risk = "high" }
  if (sensitivePath(command) && (base === "rm" || base === "remove-item" || base === "del")) { reasons.push("Attempting to modify sensitive system path"); risk = "critical" }

  const recursive = (base === "rm" && /-rf\b|--recursive\b/.test(command)) || (base === "remove-item" && /-recurse\b/.test(command))
  if (recursive) {
    if (/[/~\\]\s*$/.test(command.trim()) || sensitivePath(command)) { reasons.push("Recursive delete targeting root or sensitive directory"); risk = "critical" }
    else { if (risk === "low") risk = "medium"; reasons.push("Recursive delete — verify target") }
  }

  if (DANGEROUS.has(base) && /--force\b|-f\b/i.test(command)) { if (risk === "low") risk = "medium"; reasons.push("Force flag on potentially destructive command") }
  if ((base === "curl" || base === "wget") && /\|\s*(bash|sh|zsh|fish|powershell|pwsh|cmd)/i.test(command)) { reasons.push("Download and execute pattern detected"); risk = "critical" }
  if (base === "docker" && /--privileged\b/.test(command)) { reasons.push("Docker privileged mode — host access risk"); risk = "high" }
  if (base === "docker" && /-v\s+\/:/i.test(command)) { reasons.push("Docker mounting root filesystem"); risk = "critical" }
  if (/export\s+LD_PRELOAD/i.test(command) || /LD_PRELOAD\s*=/i.test(command)) { reasons.push("LD_PRELOAD manipulation — code injection risk"); risk = "critical" }
  if (/crontab\s+-r/i.test(command)) { reasons.push("Removing all crontab entries"); risk = "high" }
  if (/ssh-keygen/i.test(command) && /-N\s+""/i.test(command)) { reasons.push("Generating SSH key with empty passphrase"); if (risk === "low") risk = "medium" }
  if (/\biptables\b/.test(command) && /-F\b|--flush\b/.test(command)) { reasons.push("Flushing all firewall rules"); risk = "high" }
  if (/\bsystemctl\b/.test(command) && /(?:stop|disable|mask)\s+/i.test(command) && /\bsshd?\b|\bfirewalld?\b/i.test(command)) { reasons.push("Stopping/disabling critical system service"); risk = "high" }
  if (/\bdd\s+.*of=\/dev\//i.test(command)) { reasons.push("dd writing directly to device — disk destruction risk"); risk = "critical" }
  if (/encodedcommand/i.test(command) || (/\b-enc\b/i.test(command) && /\bpowershell\b|\bpwsh\b/i.test(command))) { reasons.push("PowerShell encoded command — obfuscation risk"); risk = "high" }
  if (/executionpolicy\s+bypass/i.test(command) || /executionpolicy\s+unrestricted/i.test(command)) { reasons.push("PowerShell execution policy bypass"); risk = "high" }
  if (/>\s*.*\/\.bashrc/i.test(command) || />\s*.*\/\.zshrc/i.test(command) || />\s*.*\/\.profile/i.test(command) || />\s*.*\/\.bash_profile/i.test(command)) { reasons.push("Overwriting shell configuration file"); risk = "high" }
  if ((/\/etc\/resolv\.conf/i.test(command) || /\/etc\/hosts/i.test(command)) && (base === "rm" || base === "remove-item" || />/.test(command))) { reasons.push("Modifying DNS/network configuration"); risk = "high" }

  return { safe: reasons.length === 0, blocked: risk === "critical", reasons, risk }
}

export function isCommandSafe(cmd: string) { return validate(cmd).safe }

export function getSecurityReport(cmd: string): string {
  const r = validate(cmd)
  if (r.safe) return "✓ No security concerns"
  const lines = [`Security: ${r.risk.toUpperCase()}`, ...r.reasons.map(x => `  - ${x}`)]
  if (r.blocked) lines.push("  BLOCKED: This command cannot be executed.")
  return lines.join("\n")
}

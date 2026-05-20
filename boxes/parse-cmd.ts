/**
 * parse-cmd.ts — Extract base command from shell string
 * Zero deps. Pure regex.
 *
 * base("sudo rm -rf /") → "sudo"
 * base("/usr/bin/git status") → "git"
 * base("MKFS.EXT4 /dev/sda1") → "mkfs.ext4"
 */

export function base(raw: string): string {
  const t = raw.trim()
  const m = t.match(/^([A-Za-z_.\-/][A-Za-z0-9_.\-/]*)/)
  if (!m) return t.split(/\s+/)[0]?.toLowerCase() ?? ""
  const parts = m[1].split("/")
  return parts[parts.length - 1].toLowerCase()
}

export function split(cmd: string): string[] {
  return cmd.split(/[|;&]/).map(s => s.trim()).filter(Boolean)
}

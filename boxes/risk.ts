/**
 * risk.ts — Evaluate shell command safety
 * Zero deps. Pure regex + Set + logic.
 *
 * check("sudo rm -rf /") → { ok: false, block: true, level: "critical", why: [...] }
 * check("git status")     → { ok: true,  block: false, level: "low",    why: [] }
 */

import { base, split } from "./parse-cmd"

export type Verdict = { ok: boolean; block: boolean; level: "low" | "mid" | "high" | "crit"; why: string[] }

const B = new Set(["dd","shred","wipefs","sudo","su","pkexec","gksudo","kdesudo","sudoedit","keylogger","insmod","rmmod","modprobe"])
const BP = ["mkfs"]
const D = new Set(["rm","rmdir","format","del","erase","remove-item","rd","kill","killall","pkill","taskkill","curl","wget","nc","ncat","socat","npm","npx","pip","pip3","gem","cargo","go","docker","aws","gcloud","az"])

const P = [
  /;\s*(rm|sudo|mkfs|dd|shred|format|del)\b/i, /&&\s*(rm|sudo|mkfs|dd|shred|format|del)\b/i,
  /\|\s*(rm|sudo|mkfs|dd|shred|format|del)\b/i, /\$\([^)]*\)/, /`[^`]*`/, />\s*\/dev\//i,
  /chmod\s+777/i, /chmod\s+[+-].*s/i, /chown\s+.*root/i,
  /\\x[0-9a-f]{2}/i, /\\u[0-9a-f]{4}/i, /\\[0-7]{3}/, /\$'\x/,
  />\s*\/etc\/passwd/i, />\s*\/etc\/shadow/i, /cat\s+\/etc\/shadow/i, /cat\s+\/etc\/passwd.*>/i,
]
const TR = [/\.\.[\\/]/, /\.\.[\\/]|\.\.$/]
const X = [/curl.*\$\{?HOME/i,/curl.*\$HOME/i,/wget.*\$HOME/i,/curl.*\$\{?AWS/i,/curl.*\$\{?API_KEY/i,/curl.*\$\{?SECRET/i,/curl.*\$\{?TOKEN/i,/curl.*\$\{?PASSWORD/i,/echo.*\$.*\|.*nc/i,/echo.*\$.*\|.*curl/i]
const SA = [/exec\s+rm/i,/eval\s+.*rm/i,/\bsource\s+\/dev\//i,/\.\s+\/dev\//i,/unset\s+PATH/i,/PATH\s*=\s*""/i,/export\s+PATH\s*=\s*""/i,/\bsudoedit\b/i]
const SENS = ["/etc/passwd","/etc/shadow","/etc/ssh","/root/.ssh","/.ssh","/boot/","\\boot\\","/proc/sys/","/sys/","/dev/","C:\\Windows\\System32","C:\\Windows\\SysWOW64"]

function hit(c: string, ps: RegExp[], label: string, w: string[]): boolean {
  return ps.some(p => { if (p.test(c)) { w.push(`${label}: ${p.source}`); return true }; return false })
}

function sens(t: string): boolean {
  const l = t.toLowerCase()
  return SENS.some(s => l.includes(s.toLowerCase()))
}

function pipeBad(c: string): boolean {
  return split(c).some(p => { const b = base(p); return B.has(b) || BP.some(pre => b.startsWith(pre+".") || b === pre) })
}

export function check(cmd: string): Verdict {
  const w: string[] = []
  let lv: Verdict["level"] = "low"
  const b = base(cmd)

  if (B.has(b)) return { ok: false, block: true, level: "crit", why: [`blocked: ${b}`] }
  if (BP.some(p => b.startsWith(p+".") || b === p)) return { ok: false, block: true, level: "crit", why: [`blocked prefix: ${b}`] }
  if (pipeBad(cmd)) return { ok: false, block: true, level: "crit", why: ["destructive in chain"] }
  if (hit(cmd, P, "inject", w)) lv = "high"
  if (hit(cmd, SA, "shell", w)) lv = "high"
  if (hit(cmd, X, "exfil", w)) lv = "crit"
  if (D.has(b) && TR.some(p => p.test(cmd))) { w.push("traversal"); lv = "high" }
  if (sens(cmd) && (b==="rm"||b==="remove-item"||b==="del")) { w.push("sensitive"); lv = "crit" }
  const rec = (b==="rm"&&/-rf\b|--recursive\b/i.test(cmd))||(b==="remove-item"&&/-recurse\b/i.test(cmd))
  if (rec) { if (/[/~\\]\s*$/.test(cmd.trim())||sens(cmd)) { w.push("rec-del root"); lv="crit" } else { if(lv==="low")lv="mid"; w.push("rec-del") } }
  if (D.has(b)&&/--force\b|-f\b/i.test(cmd)) { if(lv==="low")lv="mid"; w.push("force") }
  if ((b==="curl"||b==="wget")&&/\|\s*(bash|sh|zsh|fish|powershell|pwsh|cmd)/i.test(cmd)) { w.push("dl+exec"); lv="crit" }
  if (b==="docker"&&/--privileged\b/.test(cmd)) { w.push("docker priv"); lv="high" }
  if (b==="docker"&&/-v\s+\/:/i.test(cmd)) { w.push("docker root"); lv="crit" }
  if (/export\s+LD_PRELOAD/i.test(cmd)||/LD_PRELOAD\s*=/i.test(cmd)) { w.push("LD_PRELOAD"); lv="crit" }
  if (/crontab\s+-r/i.test(cmd)) { w.push("crontab"); lv="high" }
  if (/ssh-keygen/i.test(cmd)&&/-N\s+""/i.test(cmd)) { w.push("ssh no-pass"); if(lv==="low")lv="mid" }
  if (/\biptables\b/.test(cmd)&&/-F\b|--flush\b/.test(cmd)) { w.push("firewall"); lv="high" }
  if (/\bsystemctl\b/.test(cmd)&&/(?:stop|disable|mask)\s+/i.test(cmd)&&(/\bsshd?\b/i.test(cmd)||/\bfirewalld?\b/i.test(cmd))) { w.push("svc stop"); lv="high" }
  if (/\bdd\s+.*of=\/dev\//i.test(cmd)) { w.push("dd dev"); lv="crit" }
  if (/encodedcommand/i.test(cmd)||(/\b-enc\b/i.test(cmd)&&/\bpowershell\b|\bpwsh\b/i.test(cmd))) { w.push("ps-enc"); lv="high" }
  if (/executionpolicy\s+bypass/i.test(cmd)||/executionpolicy\s+unrestricted/i.test(cmd)) { w.push("ps-policy"); lv="high" }
  if (/>\s*.*\/\.bashrc/i.test(cmd)||/>\s*.*\/\.zshrc/i.test(cmd)||/>\s*.*\/\.profile/i.test(cmd)||/>\s*.*\/\.bash_profile/i.test(cmd)) { w.push("rc overwrite"); lv="high" }
  if ((/\/etc\/resolv\.conf/i.test(cmd)||/\/etc\/hosts/i.test(cmd))&&(b==="rm"||b==="remove-item"||/>/.test(cmd))) { w.push("dns"); lv="high" }
  return { ok: w.length===0, block: lv==="crit", level: lv, why: w }
}

export function ok(cmd: string): boolean { return check(cmd).ok }
export function report(cmd: string): string {
  const r = check(cmd)
  if (r.ok) return "✓ safe"
  const l = [r.level.toUpperCase(), ...r.why.map(x => `  - ${x}`)]
  if (r.block) l.push("  BLOCKED")
  return l.join("\n")
}

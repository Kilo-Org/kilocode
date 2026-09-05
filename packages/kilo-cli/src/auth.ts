import { randomBytes } from "node:crypto"
import { lstatSync, readFileSync, writeFileSync } from "node:fs"

export function credential(filename: string) {
  const stat = lstatSync(filename, { throwIfNoEntry: false })
  if (stat) {
    if ((stat.mode & 0o077) !== 0) throw new Error("Server password file must be private to its owner (mode 0600)")
    const password = readFileSync(filename, "utf8").trim()
    if (!/^[a-f0-9]{64}$/.test(password)) throw new Error("Invalid preview server password file")
    return password
  }
  const password = randomBytes(32).toString("hex")
  writeFileSync(filename, `${password}\n`, { mode: 0o600, flag: "wx" })
  return password
}

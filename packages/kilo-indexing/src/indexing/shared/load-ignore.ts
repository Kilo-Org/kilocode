import fs from "fs/promises"
import ignore, { type Ignore } from "ignore"
import path from "path"

const files = [".gitignore", ".kilocodeignore"] as const

function notFound(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false
  }
  return "code" in err && err.code === "ENOENT"
}

async function read(root: string, name: string): Promise<string | undefined> {
  return fs.readFile(path.join(root, name), "utf8").catch((err) => {
    if (notFound(err)) {
      return undefined
    }
    throw err
  })
}

export async function loadIgnore(root: string): Promise<Ignore> {
  const ig = ignore()

  for (const name of files) {
    const txt = await read(root, name)
    if (!txt?.trim()) {
      continue
    }

    ig.add(txt)
    ig.add(name)
  }

  return ig
}

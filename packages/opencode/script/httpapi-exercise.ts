// kilocode_change start - `--shards N` fans a pass out across N child processes, each
// running `--shard i/N`. Children are fully isolated: the exerciser keys its database
// and global root by PID (test/server/httpapi-exercise/environment.ts), so shards never
// share SQLite files or on-disk state. Route coverage (missing/extra) stays correct
// because every child checks it against the full scenario list.
const args = Bun.argv.slice(2)
const shardsIndex = args.indexOf("--shards")
const shards = shardsIndex === -1 ? 0 : Number(args[shardsIndex + 1])

if (shardsIndex !== -1 && (!Number.isInteger(shards) || shards < 1)) {
  console.error(`invalid --shards ${args[shardsIndex + 1]}, expected a positive integer`)
  process.exit(1)
}

if (shards > 1) {
  const passthrough = args.filter((_, index) => index !== shardsIndex && index !== shardsIndex + 1)
  // Children must key their database and global root by their own PID. If the parent's
  // environment pins these (KILO_HTTPAPI_EXERCISE_*), every child would inherit the same
  // SQLite file and XDG root and shards would collide — strip them so isolation holds.
  const env = { ...process.env }
  delete env["KILO_HTTPAPI_EXERCISE_DB"]
  delete env["KILO_HTTPAPI_EXERCISE_GLOBAL"]
  const children = Array.from({ length: shards }, (_, index) =>
    Bun.spawn(
      [process.execPath, "run", import.meta.path, ...passthrough, "--shard", `${index}/${shards}`],
      { stdout: "pipe", stderr: "pipe", env },
    ),
  )
  const relay = async (stream: ReadableStream<Uint8Array>, tag: string, sink: NodeJS.WriteStream) => {
    const decoder = new TextDecoder()
    let buffer = ""
    for await (const chunk of stream) {
      buffer += decoder.decode(chunk, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) sink.write(`${tag} ${line}\n`)
    }
    if (buffer) sink.write(`${tag} ${buffer}\n`)
  }
  const codes = await Promise.all(
    children.map(async (child, index) => {
      const tag = `[shard ${index + 1}/${shards}]`
      await Promise.all([relay(child.stdout, tag, process.stdout), relay(child.stderr, tag, process.stderr)])
      return child.exited
    }),
  )
  process.exit(codes.every((code) => code === 0) ? 0 : 1)
}
// kilocode_change end

await import("../test/server/httpapi-exercise/index")

import path from "node:path"

const wrapper = process.platform === "win32" ? ["cmd.exe", "/d", "/c", "gradlew.bat"] : ["./gradlew"]
const child = Bun.spawn([...wrapper, ...process.argv.slice(2)], {
  cwd: path.join(import.meta.dir, ".."),
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})
process.exit(await child.exited)

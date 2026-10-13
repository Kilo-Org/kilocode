import { expect, test } from "bun:test"
import { chmod, mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Conda } from "../conda.js"

const shell = process.platform === "win32" ? test.skip : test

shell("omits the client token when conda has AAU disabled", async () => {
  const root = await mkdtemp(join(tmpdir(), "kilo-conda-off-"))
  const home = process.env.HOME
  const exe = process.env.CONDA_EXE

  try {
    await mkdir(join(root, ".conda"))
    await Bun.write(join(root, ".conda", "aau_token"), "abcdefghijklmnopqrstuv")
    const conda = join(root, "conda")
    await Bun.write(conda, "#!/bin/sh\nprintf '%s\\n' '{\"user_agent\":\"conda/26.1 aau/0.7.6\"}'\n")
    await chmod(conda, 0o755)
    process.env.HOME = root
    process.env.CONDA_EXE = conda

    expect(await Conda.clientToken()).toBeUndefined()
  } finally {
    if (home === undefined) delete process.env.HOME
    else process.env.HOME = home
    if (exe === undefined) delete process.env.CONDA_EXE
    else process.env.CONDA_EXE = exe
    await rm(root, { recursive: true, force: true })
  }
})

shell("does not start conda when no client token file exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "kilo-conda-missing-"))
  const home = process.env.HOME
  const exe = process.env.CONDA_EXE
  const marker = join(root, "started")

  try {
    const conda = join(root, "conda")
    await Bun.write(conda, `#!/bin/sh\ntouch '${marker}'\n`)
    await chmod(conda, 0o755)
    process.env.HOME = root
    process.env.CONDA_EXE = conda

    expect(await Conda.clientToken()).toBeUndefined()
    expect(await Bun.file(marker).exists()).toBe(false)
  } finally {
    if (home === undefined) delete process.env.HOME
    else process.env.HOME = home
    if (exe === undefined) delete process.env.CONDA_EXE
    else process.env.CONDA_EXE = exe
    await rm(root, { recursive: true, force: true })
  }
})

shell("bounds a stalled conda probe", async () => {
  const root = await mkdtemp(join(tmpdir(), "kilo-conda-slow-"))
  const home = process.env.HOME
  const exe = process.env.CONDA_EXE

  try {
    await mkdir(join(root, ".conda"))
    await Bun.write(join(root, ".conda", "aau_token"), "abcdefghijklmnopqrstuv")
    const conda = join(root, "conda")
    await Bun.write(conda, "#!/bin/sh\nsleep 4\n")
    await chmod(conda, 0o755)
    process.env.HOME = root
    process.env.CONDA_EXE = conda

    const start = Date.now()
    expect(await Conda.clientToken()).toBeUndefined()
    expect(Date.now() - start).toBeLessThan(3000)
  } finally {
    if (home === undefined) delete process.env.HOME
    else process.env.HOME = home
    if (exe === undefined) delete process.env.CONDA_EXE
    else process.env.CONDA_EXE = exe
    await rm(root, { recursive: true, force: true })
  }
})

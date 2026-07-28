import { createHash } from "node:crypto"
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const version = "0.11.2"
const commit = "1b80120ef26a28e065e67f89bfef873f13bdd317"
const sourceUrl = `https://codeload.github.com/containers/bubblewrap/tar.gz/${commit}`
const sourceSha256 = "55a1f42de8f62f6cd8cc414229ce166ec6128ca4386b8c25dfca4229e44b56aa"
const cache = process.env.KILO_BWRAP_CACHE ?? path.join(os.tmpdir(), "kilo-bubblewrap", commit)

const capability = `#pragma once
#include <errno.h>
#include <linux/capability.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

typedef struct __user_cap_header_struct *cap_user_header_t;
typedef struct __user_cap_data_struct *cap_user_data_t;
typedef int cap_value_t;

static inline int capget(cap_user_header_t header, cap_user_data_t data) {
  return (int) syscall(SYS_capget, header, data);
}

static inline int capset(cap_user_header_t header, const cap_user_data_t data) {
  return (int) syscall(SYS_capset, header, data);
}

static inline int cap_from_name(const char *name, cap_value_t *cap) {
  if (strcmp(name, "cap_sys_admin") == 0) {
    *cap = CAP_SYS_ADMIN;
    return 0;
  }
  errno = EINVAL;
  return -1;
}
`

const config = `#pragma once
#define PACKAGE_STRING "bubblewrap ${version} for Kilo"
#define PACKAGE_VERSION "${version}"
`

const notice = `Bubblewrap ${version}

SPDX-License-Identifier: LGPL-2.0-or-later
Source: https://github.com/containers/bubblewrap/tree/${commit}

Kilo distributes Bubblewrap as a separate executable. The complete license text is
in COPYING. The exact corresponding source is in bubblewrap-${commit}.tar.gz, and
the build recipe and generated compatibility headers are in build.ts.

The executable is statically linked with musl. Its copyright and license notices
are in MUSL-COPYRIGHT.
`

function sha256(file: string) {
  return createHash("sha256").update(readFileSync(file)).digest("hex")
}

async function source() {
  const archive = path.join(cache, `bubblewrap-${commit}.tar.gz`)
  if (!existsSync(archive) || sha256(archive) !== sourceSha256) {
    mkdirSync(cache, { recursive: true })
    const response = await fetch(sourceUrl)
    if (!response.ok) throw new Error(`Could not download Bubblewrap source: ${response.status}`)
    await Bun.write(archive, response)
    if (sha256(archive) !== sourceSha256) throw new Error("Bubblewrap source digest mismatch")
  }

  const root = path.join(cache, `bubblewrap-${commit}`)
  if (!existsSync(root)) {
    const proc = Bun.spawn(["tar", "-xzf", archive, "-C", cache], { stdout: "inherit", stderr: "inherit" })
    if ((await proc.exited) !== 0) throw new Error("Could not extract Bubblewrap source")
  }
  return { archive, root }
}

function target(arch: "x64" | "arm64") {
  return arch === "x64" ? "x86_64-linux-musl" : "aarch64-linux-musl"
}

function muslLicense(zig: string) {
  const result = Bun.spawnSync([zig, "env"])
  if (result.exitCode !== 0) throw new Error("Could not inspect the Zig toolchain")
  const match = result.stdout.toString().match(/(?:"lib_dir"\s*:\s*|\.lib_dir\s*=\s*)"([^"]+)"/)
  if (!match) throw new Error("Could not locate Zig's bundled musl license")
  const license = path.join(match[1], "libc", "musl", "COPYRIGHT")
  if (!existsSync(license)) throw new Error(`Zig's bundled musl license is missing at ${license}`)
  return license
}

async function compile(arch: "x64" | "arm64") {
  const zig = process.env.ZIG ?? Bun.which("zig")
  if (!zig) {
    throw new Error(
      "Building Linux CLI artifacts requires Zig to compile the bundled Bubblewrap helper. Install Zig, set $ZIG, or use --single when building on macOS or Windows.",
    )
  }
  const sourceTree = await source()
  const out = path.join(cache, `bwrap-${arch}`)
  const include = path.join(cache, "include", "sys")
  const generated = path.join(cache, "generated")
  mkdirSync(include, { recursive: true })
  mkdirSync(generated, { recursive: true })
  await Bun.write(path.join(include, "capability.h"), capability)
  await Bun.write(path.join(generated, "config.h"), config)

  const args = [
    zig,
    "cc",
    "-target",
    target(arch),
    "-static",
    "-fPIE",
    "-pie",
    "-s",
    "-O2",
    "-D_GNU_SOURCE",
    "-I",
    path.join(cache, "include"),
    "-I",
    generated,
    "-I",
    sourceTree.root,
    path.join(sourceTree.root, "bubblewrap.c"),
    path.join(sourceTree.root, "bind-mount.c"),
    path.join(sourceTree.root, "network.c"),
    path.join(sourceTree.root, "utils.c"),
    "-o",
    out,
  ]
  const proc = Bun.spawn(args, { stdout: "inherit", stderr: "inherit" })
  if ((await proc.exited) !== 0) throw new Error(`Could not build Bubblewrap for Linux ${arch}`)
  chmodSync(out, 0o755)

  return {
    executable: out,
    digest: sha256(out),
    archive: sourceTree.archive,
    license: path.join(sourceTree.root, "COPYING"),
    musl: muslLicense(zig),
  }
}

const builds = new Map<"x64" | "arm64", ReturnType<typeof compile>>()

export function buildBubblewrap(arch: "x64" | "arm64") {
  const cached = builds.get(arch)
  if (cached) return cached
  const built = compile(arch)
  builds.set(arch, built)
  return built
}

export async function stageBubblewrap(arch: "x64" | "arm64", dir: string) {
  const built = await buildBubblewrap(arch)
  const licenses = path.join(dir, "licenses", "bubblewrap")
  mkdirSync(dir, { recursive: true })
  rmSync(licenses, { recursive: true, force: true })
  mkdirSync(licenses, { recursive: true })
  copyFileSync(built.executable, path.join(dir, "bwrap"))
  await Bun.write(path.join(licenses, "NOTICE"), notice)
  copyFileSync(built.license, path.join(licenses, "COPYING"))
  copyFileSync(built.musl, path.join(licenses, "MUSL-COPYRIGHT"))
  copyFileSync(built.archive, path.join(licenses, `bubblewrap-${commit}.tar.gz`))
  copyFileSync(import.meta.path, path.join(licenses, "build.ts"))
  chmodSync(path.join(dir, "bwrap"), 0o755)
  return built.digest
}

if (import.meta.main) {
  const arch = process.argv[process.argv.indexOf("--arch") + 1]
  const output = process.argv[process.argv.indexOf("--output") + 1]
  if ((arch !== "x64" && arch !== "arm64") || !output) {
    throw new Error("Usage: bun bubblewrap.ts --arch <x64|arm64> --output <path>")
  }
  const built = await buildBubblewrap(arch)
  mkdirSync(path.dirname(output), { recursive: true })
  copyFileSync(built.executable, output)
  chmodSync(output, 0o755)
  console.log(`${output} sha256:${built.digest}`)
}

#!/usr/bin/env bun

// Turn bun.lock into a GitHub dependency submission snapshot.
//
// GitHub's dependency graph does not parse bun.lock, and Dependabot security
// updates do not support bun. Without this, the graph only reads each
// workspace package.json, which lists direct dependencies by range, so every
// transitive dependency (and every direct one declared as `catalog:`) is
// invisible and never gets a Dependabot alert. Submitting the resolved
// lockfile closes that gap: Dependabot raises alerts for submitted
// dependencies (it does not open security update PRs for them), and
// security-findings-notify.yml reports them like any other alert.
//
// Everything is submitted under one manifest, `bun.lock`, so an advisory
// raises one alert per vulnerable version rather than one per workspace. Use
// `bun why <package>` to see which workspace pulls it in.
//
//   bun script/kilocode/dependency-snapshot.ts [bun.lock] > snapshot.json
//   gh api --method POST repos/<owner>/<repo>/dependency-graph/snapshots --input snapshot.json

import { entry, load, purl, resolve, type Lock } from "./sbom/lock"

type Scope = "runtime" | "development"

type Node = {
  package_url: string
  relationship: "direct" | "indirect"
  scope: Scope
  dependencies: Set<string>
}

type Task = { from: string; names: string[]; owner?: string; scope: Scope }

function names(...deps: (Record<string, string> | undefined)[]) {
  return [...new Set(deps.flatMap((dep) => Object.keys(dep ?? {})))]
}

// Every npm package bun.lock resolves, across all workspaces and platforms.
// Packages reachable from any workspace's dependencies, optionalDependencies
// or peerDependencies are `runtime`; packages reachable only through
// devDependencies are `development`. Workspace links are walked as their own
// roots, and non-registry packages (git, tarball URLs) are returned in
// `skipped` because they have no npm purl to match advisories against.
export function graph(lock: Lock) {
  const nodes = new Map<string, Node>()
  const seen = new Set<string>()
  const skipped = new Set<string>()
  const roots = Object.entries(lock.workspaces).map(([dir, ws]) => ({ from: dir === "" ? "" : (ws.name ?? dir), ws }))

  const walk = (queue: Task[]) => {
    while (queue.length) {
      const task = queue.shift()!
      for (const name of task.names) {
        // Unresolvable names are optional peers nobody installed.
        const key = resolve(lock, task.from, name)
        const item = key ? entry(lock, key) : undefined
        if (!key || !item || item.kind === "workspace") continue
        if (item.kind !== "npm") {
          skipped.add(`${item.name}@${item.version}`)
          continue
        }
        const id = purl(item.name, item.version)
        const node = nodes.get(id) ?? {
          package_url: id,
          relationship: "indirect",
          scope: task.scope,
          dependencies: new Set<string>(),
        }
        nodes.set(id, node)
        if (task.owner == null) node.relationship = "direct"
        if (task.owner != null) nodes.get(task.owner)?.dependencies.add(id)
        if (seen.has(key)) continue
        seen.add(key)
        const info = item.info
        queue.push({
          from: key,
          names: names(info.dependencies, info.optionalDependencies, info.peerDependencies),
          owner: id,
          scope: task.scope,
        })
      }
    }
  }

  // Runtime first, so a package used both ways keeps the stronger scope.
  walk(
    roots.map((root) => ({
      from: root.from,
      names: names(root.ws.dependencies, root.ws.optionalDependencies, root.ws.peerDependencies),
      scope: "runtime",
    })),
  )
  walk(roots.map((root) => ({ from: root.from, names: names(root.ws.devDependencies), scope: "development" })))

  return { nodes, skipped: [...skipped].sort() }
}

export function snapshot(input: {
  lock: Lock
  sha: string
  ref: string
  correlator: string
  id: string
  url?: string
  scanned: string
}) {
  const result = graph(input.lock)
  const resolved = Object.fromEntries(
    [...result.nodes.values()]
      .sort((a, b) => a.package_url.localeCompare(b.package_url))
      .map((node) => [
        node.package_url,
        {
          package_url: node.package_url,
          relationship: node.relationship,
          scope: node.scope,
          dependencies: [...node.dependencies].sort(),
        },
      ]),
  )
  return {
    skipped: result.skipped,
    body: {
      version: 0,
      sha: input.sha,
      ref: input.ref,
      job: { correlator: input.correlator, id: input.id, ...(input.url ? { html_url: input.url } : {}) },
      detector: {
        name: "kilo-bun-lock",
        version: "1.0.0",
        url: "https://github.com/Kilo-Org/kilocode/blob/main/script/kilocode/dependency-snapshot.ts",
      },
      scanned: input.scanned,
      manifests: {
        "bun.lock": { name: "bun.lock", file: { source_location: "bun.lock" }, resolved },
      },
    },
  }
}

if (import.meta.main) {
  const file = process.argv[2] ?? "bun.lock"
  const env = process.env
  const sha = env.GITHUB_SHA ?? (await Bun.$`git rev-parse HEAD`.text()).trim()
  const ref = env.GITHUB_REF ?? (await Bun.$`git symbolic-ref HEAD`.text()).trim()
  const url =
    env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
      ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
      : undefined
  const result = snapshot({
    lock: await load(file),
    sha,
    ref,
    correlator: `${env.GITHUB_WORKFLOW ?? "local"}-bun-lock`,
    id: env.GITHUB_RUN_ID ?? "local",
    url,
    scanned: new Date().toISOString(),
  })
  const count = Object.keys(result.body.manifests["bun.lock"].resolved).length
  console.error(`dependency-snapshot: ${count} npm packages from ${file}`)
  for (const item of result.skipped) console.error(`dependency-snapshot: skipped non-registry package ${item}`)
  console.log(JSON.stringify(result.body))
}

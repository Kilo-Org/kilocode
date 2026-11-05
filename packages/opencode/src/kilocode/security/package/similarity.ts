/**
 * Explainable package-name similarity. A look-alike name is one heuristic signal among several; it is
 * never a decision on its own. Every match names the well-known package it resembles and *why*
 * (edit distance, separator / affix / scope variation, digit-for-letter homoglyphs), so a prompt can
 * say "resembles `axios-retry`" instead of "score 0.83".
 *
 * The reference list is a static snapshot of widely used npm packages. It is deliberately small and
 * offline: the goal is to catch names derived from popular ones (typosquats, slopsquats that riff on a
 * known name), not to rank the registry.
 */
export namespace PackageSimilarity {
  export type Kind = "separator" | "homoglyph" | "affix" | "edit-distance" | "scope"

  export interface Match {
    /** The well-known package the name resembles. */
    target: string
    kind: Kind
    /** Optimal-string-alignment distance for `edit-distance` matches. */
    distance?: number
  }

  export const POPULAR: readonly string[] = [
    "react",
    "react-dom",
    "react-router",
    "react-router-dom",
    "next",
    "vue",
    "vue-router",
    "svelte",
    "angular",
    "@angular/core",
    "@angular/cli",
    "lodash",
    "lodash-es",
    "underscore",
    "ramda",
    "express",
    "koa",
    "fastify",
    "hapi",
    "@hapi/hapi",
    "@nestjs/core",
    "axios",
    "axios-retry",
    "node-fetch",
    "got",
    "ky",
    "superagent",
    "request",
    "chalk",
    "commander",
    "yargs",
    "minimist",
    "inquirer",
    "prompts",
    "ora",
    "debug",
    "winston",
    "pino",
    "bunyan",
    "morgan",
    "typescript",
    "ts-node",
    "tsx",
    "tslib",
    "eslint",
    "prettier",
    "babel",
    "@babel/core",
    "@babel/preset-env",
    "webpack",
    "webpack-cli",
    "vite",
    "rollup",
    "esbuild",
    "parcel",
    "@swc/core",
    "terser",
    "jest",
    "mocha",
    "chai",
    "vitest",
    "cypress",
    "playwright",
    "puppeteer",
    "supertest",
    "sinon",
    "moment",
    "dayjs",
    "date-fns",
    "luxon",
    "uuid",
    "nanoid",
    "dotenv",
    "dotenv-expand",
    "cross-env",
    "nodemon",
    "concurrently",
    "npm-run-all",
    "rimraf",
    "mkdirp",
    "glob",
    "fast-glob",
    "globby",
    "minimatch",
    "micromatch",
    "chokidar",
    "fs-extra",
    "graceful-fs",
    "semver",
    "async",
    "bluebird",
    "p-limit",
    "ws",
    "socket.io",
    "socket.io-client",
    "jsonwebtoken",
    "jose",
    "bcrypt",
    "bcryptjs",
    "passport",
    "cors",
    "helmet",
    "body-parser",
    "cookie-parser",
    "express-session",
    "multer",
    "mongoose",
    "mongodb",
    "sequelize",
    "prisma",
    "@prisma/client",
    "knex",
    "pg",
    "mysql",
    "mysql2",
    "sqlite3",
    "better-sqlite3",
    "redis",
    "ioredis",
    "zod",
    "joi",
    "yup",
    "ajv",
    "class-validator",
    "validator",
    "qs",
    "form-data",
    "mime",
    "mime-types",
    "sharp",
    "jimp",
    "cheerio",
    "jsdom",
    "marked",
    "markdown-it",
    "highlight.js",
    "prismjs",
    "js-yaml",
    "yaml",
    "xml2js",
    "csv-parse",
    "papaparse",
    "execa",
    "shelljs",
    "zx",
    "tar",
    "archiver",
    "adm-zip",
    "unzipper",
    "core-js",
    "regenerator-runtime",
    "rxjs",
    "immer",
    "redux",
    "@reduxjs/toolkit",
    "react-redux",
    "zustand",
    "mobx",
    "jotai",
    "@tanstack/react-query",
    "swr",
    "graphql",
    "apollo-server",
    "@apollo/client",
    "tailwindcss",
    "postcss",
    "autoprefixer",
    "sass",
    "less",
    "styled-components",
    "@emotion/react",
    "classnames",
    "clsx",
    "@types/node",
    "@types/react",
    "@types/express",
    "@types/lodash",
    "aws-sdk",
    "@aws-sdk/client-s3",
    "googleapis",
    "firebase",
    "firebase-admin",
    "stripe",
    "twilio",
    "nodemailer",
    "@sendgrid/mail",
    "openai",
    "@anthropic-ai/sdk",
    "langchain",
    "@langchain/core",
    "husky",
    "lint-staged",
    "@commitlint/cli",
    "semantic-release",
    "lerna",
    "nx",
    "turbo",
    "@changesets/cli",
    "electron",
    "react-native",
    "expo",
    "three",
    "d3",
    "chart.js",
    "leaflet",
    "colors",
    "picocolors",
    "kleur",
    "strip-ansi",
    "string-width",
    "boxen",
    "figlet",
    "cli-table3",
    "open",
    "node-gyp",
    "bindings",
    "node-addon-api",
    "left-pad",
    "is-odd",
    "is-even",
    "event-stream",
    "ua-parser-js",
    "coa",
    "rc",
    "ini",
  ]

  const AFFIXES = [
    "js",
    "-js",
    ".js",
    "-node",
    "node-",
    "-npm",
    "npm-",
    "2",
    "-2",
    "-official",
    "-lts",
    "-stable",
    "-new",
    "-latest",
    "-fixed",
    "-fix",
    "-secure",
    "-safe",
    "-pro",
    "-plus",
    "-ts",
    "-esm",
    "-cjs",
    "-lib",
    "-helper",
    "-helpers",
    "-utils",
    "-util",
    "-tools",
    "-toolkit",
    "-extra",
    "-ext",
    "-wrapper",
    "-client",
    "-sdk",
    "-api",
    "-core",
    "-plugin",
    "-cli",
    "-dev",
    "-next",
    "-legacy",
    "-compat",
    "-polyfill",
    "-shim",
  ]

  const HOMOGLYPHS: [RegExp, string][] = [
    [/0/g, "o"],
    [/1/g, "l"],
    [/3/g, "e"],
    [/5/g, "s"],
    [/7/g, "t"],
    [/rn/g, "m"],
    [/vv/g, "w"],
    [/ii/g, "i"],
  ]

  function basename(name: string) {
    const index = name.indexOf("/")
    return name.startsWith("@") && index !== -1 ? name.slice(index + 1) : name
  }

  function scope(name: string) {
    const index = name.indexOf("/")
    return name.startsWith("@") && index !== -1 ? name.slice(0, index) : undefined
  }

  function separators(text: string) {
    return text.replace(/[-_.]/g, "")
  }

  function homoglyphs(text: string) {
    let out = text
    for (const [pattern, replacement] of HOMOGLYPHS) out = out.replace(pattern, replacement)
    return out
  }

  /** Optimal string alignment (Damerau–Levenshtein with adjacent transpositions), early exit above `max`. */
  export function distance(a: string, b: string, max = Number.POSITIVE_INFINITY): number {
    if (a === b) return 0
    if (Math.abs(a.length - b.length) > max) return max + 1
    const rows = a.length + 1
    const cols = b.length + 1
    const d: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0))
    for (let i = 0; i < rows; i++) d[i]![0] = i
    for (let j = 0; j < cols; j++) d[0]![j] = j
    for (let i = 1; i < rows; i++) {
      let best = Number.POSITIVE_INFINITY
      for (let j = 1; j < cols; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1
        let value = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost)
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
          value = Math.min(value, d[i - 2]![j - 2]! + 1)
        d[i]![j] = value
        best = Math.min(best, value)
      }
      if (best > max) return max + 1
    }
    return d[a.length]![b.length]!
  }

  /**
   * Find the well-known package `name` resembles, if any. Exact members of the reference list never
   * match (they *are* the well-known package). `reference` defaults to {@link POPULAR}; callers may pass
   * an extended list.
   */
  export function similar(name: string, reference: readonly string[] = POPULAR): Match | undefined {
    const lower = name.toLowerCase()
    if (reference.includes(lower)) return undefined
    const base = basename(lower)
    const ownScope = scope(lower)
    const matches: Match[] = []

    for (const target of reference) {
      const targetBase = basename(target)
      const targetScope = scope(target)
      // `@evil/react`, `@react/core`: a well-known unscoped name under a foreign scope.
      if (ownScope !== undefined && targetScope === undefined && base === targetBase) {
        matches.push({ target, kind: "scope" })
        continue
      }
      // `types-node` for `@types/node`: the scope flattened into the name.
      if (targetScope !== undefined && ownScope === undefined && lower === `${targetScope.slice(1)}-${targetBase}`) {
        matches.push({ target, kind: "scope" })
        continue
      }
      if (ownScope !== targetScope && (ownScope !== undefined || targetScope !== undefined)) continue
      if (base === targetBase) continue
      if (separators(base) === separators(targetBase)) {
        matches.push({ target, kind: "separator" })
        continue
      }
      if (homoglyphs(base) === homoglyphs(targetBase) || homoglyphs(separators(base)) === separators(targetBase)) {
        matches.push({ target, kind: "homoglyph" })
        continue
      }
      if (AFFIXES.some((affix) => base === targetBase + affix || base === affix + targetBase)) {
        matches.push({ target, kind: "affix" })
        continue
      }
      const shorter = Math.min(base.length, targetBase.length)
      if (shorter < 4) continue
      const max = shorter <= 7 ? 1 : 2
      const found = distance(base, targetBase, max)
      if (found <= max) matches.push({ target, kind: "edit-distance", distance: found })
    }

    if (matches.length === 0) return undefined
    // Prefer the most specific explanation, then the closer edit distance.
    const order: Kind[] = ["separator", "homoglyph", "affix", "scope", "edit-distance"]
    matches.sort((a, b) => {
      const byKind = order.indexOf(a.kind) - order.indexOf(b.kind)
      if (byKind !== 0) return byKind
      return (a.distance ?? 0) - (b.distance ?? 0)
    })
    return matches[0]
  }
}

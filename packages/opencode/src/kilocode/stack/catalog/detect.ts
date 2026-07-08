import { Effect } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Stack } from "../schema"

export type ProjectTechContext = {
  readonly dir: string
  readonly top: ReadonlySet<string>
  readonly files: ReadonlyArray<string>
  readonly extensions: ReadonlySet<string>
  readonly packageJson?: Record<string, unknown>
  readonly pyprojectText?: string
  readonly requirementsText?: string
  hasFile(name: string): boolean
  hasPath(pattern: string): boolean
  hasExtension(ext: string): boolean
  hasNpmDep(name: string): boolean
  hasPythonDep(name: string): boolean
}

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  "dist",
  "build",
  ".next",
  "target",
  "vendor",
  ".idea",
  ".vscode",
  ".cache",
  "coverage",
  ".turbo",
])

const FILE_LIMIT = 8000
const DEPTH_LIMIT = 8

function extension(name: string): string {
  const idx = name.lastIndexOf(".")
  return idx > 0 ? name.slice(idx).toLowerCase() : ""
}

function globToRegex(pattern: string): RegExp {
  const PH = "\u0001"
  let r = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  r = r.replace(/\*\*/g, PH)
  r = r.replace(/\*/g, "[^/]*")
  r = r.replace(/\?/g, "[^/]")
  r = r.replace(new RegExp(`${PH}/(?=\\S)`, "g"), "(?:.*/)?")
  r = r.replace(new RegExp(`/${PH}/(?=\\S)`, "g"), "/(?:.*/)?")
  r = r.replace(new RegExp(`/${PH}$`), "(?:/.*)?")
  r = r.replace(new RegExp(PH, "g"), ".*")
  return new RegExp("^" + r + "$")
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function npmDeps(pkg: Record<string, unknown> | undefined): Set<string> {
  const out = new Set<string>()
  if (!pkg) return out
  for (const key of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const value = pkg[key]
    if (isObject(value)) for (const name of Object.keys(value)) out.add(name.toLowerCase())
  }
  const bundled = pkg.bundledDependencies
  if (Array.isArray(bundled)) for (const name of bundled) if (typeof name === "string") out.add(name.toLowerCase())
  return out
}

function normalizePy(name: string): string {
  return name.trim().toLowerCase().replace(/_/g, "-")
}

function depName(entry: string): string {
  return entry.split(/[\s<>=!~;\[]/)[0].trim()
}

function quotedEntries(text: string): string[] {
  const out: string[] = []
  const re = /["']([^"']+)["']/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) out.push(match[1])
  return out
}

function parseRequirements(text: string | undefined): Set<string> {
  const out = new Set<string>()
  if (!text) return out
  for (const line of text.split("\n")) {
    const raw = line.split("#")[0].trim()
    if (!raw || raw.startsWith("-")) continue
    const name = normalizePy(depName(raw))
    if (name) out.add(name)
  }
  return out
}

function parsePyproject(text: string | undefined): Set<string> {
  const out = new Set<string>()
  if (!text) return out
  const depArray = text.match(/dependencies\s*=\s*\[([\s\S]*?)\]/)
  if (depArray) for (const entry of quotedEntries(depArray[1])) out.add(normalizePy(depName(entry)))
  const devArray = text.match(/dev-dependencies\s*=\s*\[([\s\S]*?)\]/)
  if (devArray) for (const entry of quotedEntries(devArray[1])) out.add(normalizePy(depName(entry)))
  const poetry = text.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(\n\[|\n[^\s]|\n$|$)/)
  if (poetry) {
    for (const line of poetry[1].split("\n")) {
      const match = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=/)
      if (match && match[1].toLowerCase() !== "python") out.add(normalizePy(match[1]))
    }
  }
  return out
}

function makeContext(input: {
  dir: string
  top: ReadonlySet<string>
  files: ReadonlyArray<string>
  extensions: ReadonlySet<string>
  packageJson?: Record<string, unknown>
  pyprojectText?: string
  requirementsText?: string
}): ProjectTechContext {
  const npm = npmDeps(input.packageJson)
  const python = new Set<string>([...parseRequirements(input.requirementsText), ...parsePyproject(input.pyprojectText)])
  const pathCache = new Map<string, RegExp>()
  const matcher = (pattern: string) =>
    pathCache.get(pattern) ?? pathCache.set(pattern, globToRegex(pattern)).get(pattern)!
  return {
    dir: input.dir,
    top: input.top,
    files: input.files,
    extensions: input.extensions,
    packageJson: input.packageJson,
    pyprojectText: input.pyprojectText,
    requirementsText: input.requirementsText,
    hasFile: (name) => input.top.has(name),
    hasPath: (pattern) => {
      const re = matcher(pattern)
      return input.files.some((file) => re.test(file))
    },
    hasExtension: (ext) => input.extensions.has(ext.toLowerCase()),
    hasNpmDep: (name) => npm.has(name.toLowerCase()),
    hasPythonDep: (name) => python.has(name.toLowerCase()),
  }
}

export function contextFrom(input: {
  dir: string
  top?: ReadonlyArray<string>
  files?: ReadonlyArray<string>
  extensions?: ReadonlyArray<string>
  packageJson?: Record<string, unknown>
  pyprojectText?: string
  requirementsText?: string
}): ProjectTechContext {
  return makeContext({
    dir: input.dir,
    top: new Set(input.top ?? []),
    files: input.files ?? [],
    extensions: new Set(input.extensions ?? []),
    packageJson: input.packageJson,
    pyprojectText: input.pyprojectText,
    requirementsText: input.requirementsText,
  })
}

export const buildContext = Effect.fn("Stack.detect.buildContext")(function* (
  dir: string,
  fs: AppFileSystem.Interface,
) {
  const top = new Set<string>()
  const files: string[] = []
  const extensions = new Set<string>()

  const visit: (prefix: string, depth: number) => Effect.Effect<void> = Effect.fnUntraced(function* (
    prefix: string,
    depth: number,
  ) {
    if (files.length >= FILE_LIMIT || depth > DEPTH_LIMIT) return
    const absolute = prefix ? `${dir}/${prefix}` : dir
    const entries = yield* fs.readDirectoryEntries(absolute).pipe(Effect.orElseSucceed(() => []))
    for (const entry of entries) {
      if (files.length >= FILE_LIMIT) return
      if (entry.type === "symlink") continue
      if (depth === 0) top.add(entry.name)
      if (entry.type === "directory") {
        if (IGNORED_DIRS.has(entry.name)) continue
        yield* visit(prefix ? `${prefix}/${entry.name}` : entry.name, depth + 1)
        continue
      }
      if (entry.type !== "file") continue
      files.push(prefix ? `${prefix}/${entry.name}` : entry.name)
      const ext = extension(entry.name)
      if (ext) extensions.add(ext)
    }
  })

  yield* visit("", 0)

  const read = (name: string) =>
    fs.readFileStringSafe(name ? `${dir}/${name}` : dir).pipe(Effect.orElseSucceed(() => undefined))

  const pkgText = yield* read("package.json")
  let packageJson: Record<string, unknown> | undefined
  if (pkgText !== undefined) {
    try {
      const parsed = JSON.parse(pkgText)
      if (isObject(parsed)) packageJson = parsed
    } catch {
      packageJson = undefined
    }
  }
  const pyprojectText = yield* read("pyproject.toml")
  const requirementsText = yield* read("requirements.txt")

  return makeContext({ dir, top, files, extensions, packageJson, pyprojectText, requirementsText })
})

type Detector = (ctx: ProjectTechContext) => string | undefined

const first = (...results: Array<string | undefined>): string | undefined => {
  for (const result of results) if (result) return result
  return undefined
}

const npmDep = (ctx: ProjectTechContext, ...names: string[]): string | undefined => {
  for (const name of names) if (ctx.hasNpmDep(name)) return `Found npm dependency \`${name}\`.`
  return undefined
}

const pyDep = (ctx: ProjectTechContext, ...names: string[]): string | undefined => {
  for (const name of names) if (ctx.hasPythonDep(name)) return `Found Python dependency \`${name}\`.`
  return undefined
}

const fileMatch = (ctx: ProjectTechContext, pattern: string): string | undefined => {
  if (ctx.hasPath(pattern)) return `Found file matching \`${pattern}\`.`
  return undefined
}

const extMatch = (ctx: ProjectTechContext, ext: string): string | undefined => {
  if (ctx.hasExtension(ext)) return `Found \`${ext}\` files.`
  return undefined
}

const registry: Partial<Record<string, Detector>> = {
  "apache-airflow": (ctx) => first(pyDep(ctx, "apache-airflow"), fileMatch(ctx, "**/dags/*.py")),
  dagster: (ctx) => first(pyDep(ctx, "dagster"), fileMatch(ctx, "**/dagster.yaml")),
  "aws-glue": (ctx) => pyDep(ctx, "awsglue"),
  prefect: (ctx) => pyDep(ctx, "prefect"),
  dbt: (ctx) => first(fileMatch(ctx, "**/dbt_project.yml"), pyDep(ctx, "dbt-core")),
  "apache-spark": (ctx) => pyDep(ctx, "pyspark"),
  "azure-event-hub": (ctx) => first(npmDep(ctx, "@azure/event-hubs"), pyDep(ctx, "azure-eventhub")),
  "aws-kinesis": (ctx) => npmDep(ctx, "@aws-sdk/client-kinesis", "aws-sdk"),
  "gcp-pubsub": (ctx) => first(npmDep(ctx, "@google-cloud/pubsub"), pyDep(ctx, "google-cloud-pubsub")),
  "apache-kafka": (ctx) =>
    first(npmDep(ctx, "kafkajs", "kafka-node"), pyDep(ctx, "confluent-kafka", "kafka-python", "aiokafka")),
  "apache-flink": (ctx) => pyDep(ctx, "apache-flink", "pyflink"),
  "apache-beam": (ctx) => pyDep(ctx, "apache-beam"),
  databricks: (ctx) =>
    first(npmDep(ctx, "@databricks/databricks-sdk", "@databricks/sql"), pyDep(ctx, "databricks-sdk")),
  snowflake: (ctx) =>
    first(
      npmDep(ctx, "snowflake-sdk", "snowflake-promise"),
      pyDep(ctx, "snowflake-connector-python", "snowflake-sqlalchemy"),
    ),
  "aws-redshift": (ctx) => first(pyDep(ctx, "redshift-connector"), npmDep(ctx, "@aws-sdk/client-redshift")),
  "gcp-bigquery": (ctx) => first(npmDep(ctx, "@google-cloud/bigquery"), pyDep(ctx, "google-cloud-bigquery")),
  "azure-adls2": (ctx) => first(npmDep(ctx, "@azure/storage-file-datalake"), pyDep(ctx, "azure-storage-file-datalake")),
  "aws-s3": (ctx) => npmDep(ctx, "@aws-sdk/client-s3", "aws-sdk"),
  "gcp-storage": (ctx) => first(npmDep(ctx, "@google-cloud/storage"), pyDep(ctx, "google-cloud-storage")),
  hdfs: (ctx) => pyDep(ctx, "hdfs", "pyarrow[hdfs]"),
  "apache-parquet": (ctx) => pyDep(ctx, "fastparquet", "pyarrow"),
  "databricks-delta": (ctx) => pyDep(ctx, "deltalake"),
  "apache-iceberg": (ctx) => pyDep(ctx, "pyiceberg"),
  "apache-avro": (ctx) => first(pyDep(ctx, "fastavro", "avro-python3", "avro"), npmDep(ctx, "avsc")),
  "apache-arrow": (ctx) => pyDep(ctx, "pyarrow"),
  "microsoft-sql-server": (ctx) => npmDep(ctx, "mssql", "tedious"),
  mysql: (ctx) => first(npmDep(ctx, "mysql", "mysql2"), pyDep(ctx, "mysql-connector-python", "pymysql", "mysqlclient")),
  postgresql: (ctx) => first(npmDep(ctx, "pg"), pyDep(ctx, "psycopg2", "psycopg2-binary", "psycopg", "asyncpg")),
  mongodb: (ctx) => first(npmDep(ctx, "mongodb"), pyDep(ctx, "pymongo", "motor")),
  elasticsearch: (ctx) => first(npmDep(ctx, "@elastic/elasticsearch"), pyDep(ctx, "elasticsearch")),
  redis: (ctx) => first(npmDep(ctx, "redis", "ioredis"), pyDep(ctx, "redis")),
  graphql: (ctx) =>
    first(
      fileMatch(ctx, "**/schema.graphql"),
      extMatch(ctx, ".graphql"),
      npmDep(ctx, "graphql", "@apollo/server", "apollo-server", "mercurius"),
    ),
  fastapi: (ctx) => pyDep(ctx, "fastapi"),
  "aws-sagemaker": (ctx) => pyDep(ctx, "sagemaker"),
  "gcp-vertex-ai": (ctx) => pyDep(ctx, "google-cloud-aiplatform"),
  "azure-ml": (ctx) => pyDep(ctx, "azure-ai-ml", "azureml-core"),
  tensorflow: (ctx) => first(pyDep(ctx, "tensorflow"), npmDep(ctx, "@tensorflow/tfjs")),
  pytorch: (ctx) => pyDep(ctx, "torch", "torchvision"),
  mlflow: (ctx) => pyDep(ctx, "mlflow"),
  "scikit-learn": (ctx) => pyDep(ctx, "scikit-learn"),
  prometheus: (ctx) =>
    first(fileMatch(ctx, "**/prometheus.yml"), fileMatch(ctx, "**/prometheus.yaml"), pyDep(ctx, "prometheus-client")),
  "great-expectations": (ctx) => first(pyDep(ctx, "great-expectations"), fileMatch(ctx, "**/great_expectations.yml")),
  "hashicorp-vault": (ctx) => first(pyDep(ctx, "hvac"), npmDep(ctx, "node-vault")),
  "delta-sharing": (ctx) => pyDep(ctx, "delta-sharing"),
  okta: (ctx) => first(npmDep(ctx, "@okta/okta-sdk-nodejs", "@okta/okta-auth-js"), pyDep(ctx, "okta")),
  "azure-key-vault": (ctx) =>
    first(
      npmDep(ctx, "@azure/keyvault-keys", "@azure/keyvault-secrets", "@azure/keyvault-certificates"),
      pyDep(ctx, "azure-keyvault-keys", "azure-keyvault-secrets", "azure-keyvault-certificates"),
    ),
}

/**
 * Emit normalized technology IDs + evidence for all technologies found in `catalog` whose
 * detector heuristic matches the `ctx`. Technology IDs not present in the detector registry
 * are silently skipped; unknown IDs emitted by future catalog versions are never returned.
 */
export function detect(ctx: ProjectTechContext, catalog: Stack.Catalog): Stack.Detection[] {
  const out: Stack.Detection[] = []
  for (const vertical of catalog.verticals) {
    for (const technology of vertical.technologies) {
      const detector = registry[technology.id]
      if (!detector) continue
      const evidence = detector(ctx)
      if (evidence) out.push({ technology: technology.id, vertical: vertical.id, evidence })
    }
  }
  return out
}

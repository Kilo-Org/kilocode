import path from "node:path"
import { describe, expect, test } from "bun:test"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Effect, Layer } from "effect"
import { buildContext, contextFrom, detect, type ProjectTechContext } from "@/kilocode/stack/catalog/detect"
import { builtin } from "@/kilocode/stack/catalog"
import { TestInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const it = testEffect(Layer.mergeAll(AppFileSystem.defaultLayer))

function ids(ctx: ProjectTechContext): string[] {
  return detect(ctx, builtin)
    .map((d) => String(d.technology))
    .toSorted()
}

function evidenceFor(ctx: ProjectTechContext, technology: string): string | undefined {
  return detect(ctx, builtin).find((d) => String(d.technology) === technology)?.evidence
}

describe("Stack detection registry", () => {
  test("detects snowflake from an npm dependency", () => {
    const ctx = contextFrom({
      dir: ".",
      packageJson: { dependencies: { "snowflake-sdk": "^1.2.3" } },
    })
    expect(ids(ctx)).toContain("snowflake")
    expect(evidenceFor(ctx, "snowflake")).toContain("snowflake-sdk")
  })

  test("detects snowflake from a python dependency", () => {
    const ctx = contextFrom({ dir: ".", requirementsText: "snowflake-connector-python==3.0\n" })
    expect(ids(ctx)).toContain("snowflake")
  })

  test("detects dbt from a dbt_project.yml file", () => {
    const ctx = contextFrom({ dir: ".", files: ["dbt_project.yml"] })
    expect(ids(ctx)).toContain("dbt")
  })

  test("detects dbt from a nested dbt_project.yml file", () => {
    const ctx = contextFrom({ dir: ".", files: ["dbt/dbt_project.yml"] })
    expect(ids(ctx)).toContain("dbt")
  })

  test("detects postgresql from npm pg and python psycopg2", () => {
    expect(ids(contextFrom({ dir: ".", packageJson: { dependencies: { pg: "^8.0" } } }))).toContain("postgresql")
    expect(ids(contextFrom({ dir: ".", requirementsText: "psycopg2-binary\n" }))).toContain("postgresql")
  })

  test("detects apache-airflow from a python dependency and from dag files", () => {
    expect(ids(contextFrom({ dir: ".", requirementsText: "apache-airflow==2.9\n" }))).toContain("apache-airflow")
    expect(ids(contextFrom({ dir: ".", files: ["dags/etl.py"] }))).toContain("apache-airflow")
  })

  test("detects fastapi from a python dependency", () => {
    expect(ids(contextFrom({ dir: ".", pyprojectText: 'dependencies = ["fastapi", "uvicorn"]\n' }))).toContain(
      "fastapi",
    )
  })

  test("detects graphql from a schema file and the graphql extension", () => {
    expect(ids(contextFrom({ dir: ".", files: ["schema.graphql"] }))).toContain("graphql")
    expect(ids(contextFrom({ dir: ".", files: ["src/schema.graphql"], extensions: [".graphql"] }))).toContain("graphql")
  })

  test("detects multiple technologies at once", () => {
    const ctx = contextFrom({
      dir: ".",
      packageJson: { dependencies: { "snowflake-sdk": "^1", mongodb: "^5" } },
      requirementsText: "fastapi\npyspark\n",
      files: ["dbt_project.yml", "dags/etl.py"],
    })
    expect(ids(ctx)).toEqual(["apache-airflow", "apache-spark", "dbt", "fastapi", "mongodb", "snowflake"].toSorted())
  })

  test("normalizes python underscore package names to hyphenated", () => {
    const ctx = contextFrom({ dir: ".", requirementsText: "great_expectations==0.18\n" })
    expect(ids(ctx)).toContain("great-expectations")
  })

  test("returns no detections for an empty project", () => {
    expect(ids(contextFrom({ dir: "." }))).toEqual([])
  })

  test("ignores dependencies that have no catalog detector", () => {
    const ctx = contextFrom({ dir: ".", packageJson: { dependencies: { lodash: "^4", express: "^4" } } })
    expect(ids(ctx)).toEqual([])
  })

  test("every detection is grouped under the data vertical", () => {
    const ctx = contextFrom({
      dir: ".",
      packageJson: { dependencies: { "snowflake-sdk": "^1", redis: "^4" } },
      requirementsText: "mlflow\n",
    })
    for (const d of detect(ctx, builtin)) expect(String(d.vertical)).toBe("data")
  })

  test("every detection carries a non-empty evidence string", () => {
    const ctx = contextFrom({
      dir: ".",
      packageJson: { dependencies: { "snowflake-sdk": "^1", redis: "^4" } },
      requirementsText: "mlflow\n",
      files: ["dbt_project.yml"],
    })
    for (const d of detect(ctx, builtin)) expect(d.evidence.length).toBeGreaterThan(0)
  })
})

describe("Stack buildContext", () => {
  it.instance("builds a context from a real project directory and detects technologies", () =>
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const test = yield* TestInstance
      yield* fs.writeWithDirs(
        path.join(test.directory, "package.json"),
        JSON.stringify({ dependencies: { "snowflake-sdk": "^1.0" } }),
      )
      yield* fs.writeWithDirs(path.join(test.directory, "dbt_project.yml"), "name: test\n")
      yield* fs.writeWithDirs(path.join(test.directory, "requirements.txt"), "apache-airflow==2.9\n")
      yield* fs.writeWithDirs(path.join(test.directory, "dags", "etl.py"), "import airflow\n")

      const ctx = yield* buildContext(test.directory, fs)
      expect(ids(ctx)).toEqual(["apache-airflow", "dbt", "snowflake"].toSorted())
    }),
  )

  it.instance("returns an empty context for a directory with no detectable signals", () =>
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const test = yield* TestInstance
      yield* fs.writeWithDirs(path.join(test.directory, "README.md"), "# project\n")
      yield* fs.writeWithDirs(path.join(test.directory, "src", "index.ts"), "console.log(1)\n")

      const ctx = yield* buildContext(test.directory, fs)
      expect(detect(ctx, builtin)).toEqual([])
    }),
  )
})

import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Stack } from "@/kilocode/stack/schema"
import {
  builtin,
  data,
  defaultable,
  defaults,
  expected,
  expectedMarketplaceResources,
  placements,
  register,
  resources,
  revision,
  validate,
  walk,
} from "@/kilocode/stack/catalog"

const digest = `sha256:${"0".repeat(64)}`

describe("Stack schemas", () => {
  test("enforces stable IDs and kind-qualified resource refs", () => {
    expect(String(Schema.decodeUnknownSync(Stack.TechnologyID)("apache-airflow"))).toBe("apache-airflow")
    expect(String(Schema.decodeUnknownSync(Stack.ResourceRef)("skill:dbt-analytics-engineering"))).toBe(
      "skill:dbt-analytics-engineering",
    )
    expect(() => Schema.decodeUnknownSync(Stack.TechnologyID)("Apache Airflow")).toThrow()
    expect(() => Schema.decodeUnknownSync(Stack.ResourceRef)("dbt-analytics-engineering")).toThrow()
  })

  test("requires environment references instead of secret parameter values", () => {
    const secret = {
      id: "api_key",
      label: "API key",
      required: true,
      sensitive: true,
      env: "DBT_API_KEY",
    }
    const decoded = Schema.decodeUnknownSync(Stack.Parameter)(secret)
    expect(String(decoded.id)).toBe(secret.id)
    expect(decoded).toMatchObject({
      label: "API key",
      required: true,
      sensitive: true,
      env: "DBT_API_KEY",
    })
    expect(() =>
      Schema.decodeUnknownSync(Stack.Parameter)({
        id: "api_key",
        label: "API key",
        required: true,
        sensitive: true,
        default: "raw-secret",
      }),
    ).toThrow()
  })

  test("decodes the versioned project config shape", () => {
    const input = {
      version: 1,
      catalog_revision: revision,
      verticals: { data: { technologies: ["dbt"] } },
      resources: {
        "mcp:dbt": {
          enabled: true,
          method: "local-uvx",
          parameters: { project_dir: "." },
        },
      },
      managed: {
        "mcp:dbt": {
          marketplace_id: "dbt",
          version: "1.0.0",
          digest,
          fingerprint: digest,
        },
      },
    }
    expect(JSON.stringify(Schema.decodeUnknownSync(Stack.Config)(input))).toBe(JSON.stringify(input))
  })

  test("validates plain transport IDs and record keys", () => {
    expect(() =>
      Schema.decodeUnknownSync(Stack.Draft)({ verticals: { Data: { technologies: [] } }, resources: {} }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(Stack.Draft)({ verticals: { data: { technologies: ["DBT"] } }, resources: {} }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(Stack.Draft)({ verticals: {}, resources: { dbt: { enabled: true } } }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(Stack.Receipt)({
        marketplace_id: "DBT",
        version: "1.0.0",
        digest,
        fingerprint: digest,
      }),
    ).toThrow()
  })

  test("supports future verticals and recursive category depth", () => {
    const future = Schema.decodeUnknownSync(Stack.Vertical)({
      id: "web",
      name: "Web Development",
      technologies: [],
      categories: [
        {
          id: "web-platform",
          name: "Platform",
          technologies: [],
          categories: [
            {
              id: "web-frameworks",
              name: "Frameworks",
              technologies: [],
              categories: [
                {
                  id: "web-frameworks-meta",
                  name: "Meta-frameworks",
                  technologies: [],
                  categories: [],
                },
              ],
            },
          ],
        },
      ],
    })
    const catalog = register(
      revision,
      [
        { vertical: data, resources },
        { vertical: future, resources: [resources[0]] },
      ],
      expected,
    )
    expect(catalog.verticals).toHaveLength(2)
    expect(catalog.resources).toHaveLength(resources.length)
    expect(walk(future.categories).map((category) => String(category.id))).toEqual([
      "web-platform",
      "web-frameworks",
      "web-frameworks-meta",
    ])
  })
})

describe("Data Engineering catalog", () => {
  test("retains the approved technology and placement counts", () => {
    expect(data.technologies).toHaveLength(100)
    expect(placements(data)).toHaveLength(103)
    expect(data.technologies.reduce((count, technology) => count + technology.resources.length, 0)).toBe(247)
    expect(resources).toHaveLength(207)
  })

  test("normalizes only ADF, AWS Glue, and Hudi into duplicate placements", () => {
    const counts = new Map<Stack.TechnologyID, number>()
    for (const placement of placements(data)) {
      counts.set(placement.technology, (counts.get(placement.technology) ?? 0) + 1)
    }
    expect([...counts.entries()].filter(([, count]) => count > 1).toSorted()).toEqual([
      [Stack.TechnologyID.make("apache-hudi"), 2],
      [Stack.TechnologyID.make("aws-glue"), 2],
      [Stack.TechnologyID.make("azure-data-factory"), 2],
    ])
  })

  test("keeps all technology, category, and resource IDs unique", () => {
    const technologies = data.technologies.map((technology) => technology.id)
    const categories = walk(data.categories).map((category) => category.id)
    const refs = resources.map((resource) => resource.ref)
    expect(new Set(technologies).size).toBe(technologies.length)
    expect(new Set(categories).size).toBe(categories.length)
    expect(new Set(refs).size).toBe(refs.length)
  })

  test("matches the stable expected Marketplace resource manifest", () => {
    const refs = new Set(data.technologies.flatMap((technology) => technology.resources.map((item) => item.ref)))
    expect([...refs].toSorted()).toEqual(expectedMarketplaceResources)
    expect(expected).toBe(expectedMarketplaceResources)
    expect(new Bun.CryptoHasher("sha256").update(expected.join("\n")).digest("hex")).toBe(
      "12ad000d580a352c93e2e197749c68468875d3fd782a6d9c30679c7333a2e69a",
    )
  })

  test("excludes resources unavailable after the Marketplace audit", () => {
    const excluded = new Set<string>([
      "skill:adding-dbt-unit-test",
      "skill:data-quality-frameworks-wshobson",
      "skill:cli",
      "skill:apache-iceberg-expert",
      "skill:aws-glue",
      "skill:bigdata-analysis",
      "skill:conjur",
      "skill:copy-connections",
      "skill:cyberark",
      "skill:data-catalog-entry",
      "skill:data-discovery",
      "skill:db2-sql-expert",
      "skill:dremio-lakehouse-modeling",
      "skill:dremio-python-libraries",
      "skill:gcp-pubsub-spring",
      "skill:google-cloud",
      "skill:google-cloud-secret-manager-js",
      "skill:json-to-xml-converter",
      "skill:kafka-stream-processing",
      "skill:newrelic-nrql-debug-ladder",
      "skill:okta",
      "skill:privacera",
      "skill:prometheus-builderio",
      "skill:qlik-cloud",
      "skill:sql-server-performance",
      "mcp:adf-cost-intelligence-mcp",
      "mcp:adls2-mcp",
      "mcp:airflow-us-all",
      "mcp:ambari-mcp",
      "mcp:apache-atlas-mcp",
      "mcp:apache-gravitino-mcp",
      "mcp:apollo-mcp",
      "mcp:astro-airflow-mcp",
      "mcp:avrotize",
      "mcp:awslabs-kinesis-mcp-server",
      "mcp:azure-data-factory-consultant",
      "mcp:azure-machine-learning-mcp",
      "mcp:azure-purview-mcp",
      "mcp:cdata-avro-mcp",
      "mcp:cdata-cassandra-mcp",
      "mcp:cdata-code-assist-mcp",
      "mcp:cdata-db2-mcp",
      "mcp:cdata-gcs-mcp",
      "mcp:cdata-hbase-mcp",
      "mcp:cdata-hdfs-mcp",
      "mcp:cdata-json-mcp",
      "mcp:cdata-parquet-mcp",
      "mcp:cdata-redshift-mcp",
      "mcp:cloudera-iceberg-mcp",
      "mcp:cognito-mcp",
      "mcp:collibra-mcp-for-databricks",
      "mcp:collibra-mcp-local",
      "mcp:csv-tools-mcp",
      "mcp:cyberark-sca",
      "mcp:dagster-mcp",
      "mcp:databricks-mcp-server",
      "mcp:databricks-sdk-mcp",
      "mcp:datadog-mcp-dreamiurg",
      "mcp:datarobot-mcp-af",
      "mcp:dbt-core-mcp",
      "mcp:dbt-us-all",
      "mcp:dremio-mcp",
      "mcp:dremio-mcp-lite",
      "mcp:elastic-agent-builder-mcp",
      "mcp:enterprise-mcp",
      "mcp:entra-mcp",
      "mcp:fivetran-mcp",
      "mcp:flink-mcp",
      "mcp:gcloud",
      "mcp:gcs-mcp",
      "mcp:gitmcp-apache-atlas",
      "mcp:glue-mcp",
      "mcp:google-cloud-mcp",
      "mcp:google-mcp-toolbox",
      "mcp:google-workspace-mcp",
      "mcp:graphql-to-mcp",
      "mcp:hi-gcloud",
      "mcp:hue-mcp",
      "mcp:ibm-i-mcp",
      "mcp:iceberg-mcp-server",
      "mcp:infoinlet-mongodb",
      "mcp:invoicexml",
      "mcp:kafka-mcp-server",
      "mcp:looker-mcp-server",
      "mcp:matillion",
      "mcp:mcp-azure-toolkit",
      "mcp:mcp-for-splunk",
      "mcp:mcp-json-tools",
      "mcp:mcp-server-dagster",
      "mcp:mcp-server-parquet",
      "mcp:mcp-server-scikit-learn",
      "mcp:mcp-snowflake-server",
      "mcp:mlflow-us-all",
      "mcp:newrelic-mcp",
      "mcp:nifi-mcp-universal",
      "mcp:oracle-sqlcl-mcp",
      "mcp:privilege-cloud-mcp",
      "mcp:prometheus-pab1it0",
      "mcp:prometheus-tjhop",
      "mcp:purview-unified-catalog-mcp",
      "mcp:pytorch-mcp-server",
      "mcp:qlik-sense-mcp",
      "mcp:qsv-mcp",
      "mcp:sap-bdc-mcp-server",
      "mcp:snowflake-mcp-server",
      "mcp:spark-documentation",
      "mcp:spark-sql-mcp",
      "mcp:sylphlab-xml",
      "mcp:tableau-mcp-server",
      "mcp:tako-mcp",
      "mcp:tokenlite-mysql-mcp",
      "mcp:trino-mcp",
    ])
    expect(excluded.size).toBe(112)
    expect(resources.some((resource) => excluded.has(resource.ref))).toBeFalse()
    expect(expected.some((ref) => excluded.has(ref))).toBeFalse()
    expect(
      data.technologies.some((technology) => technology.resources.some((association) => excluded.has(association.ref))),
    ).toBeFalse()
  })

  test("normalizes the shared Confluent server to one Marketplace resource", () => {
    const kafka = data.technologies.find((technology) => technology.id === "apache-kafka")
    const flink = data.technologies.find((technology) => technology.id === "apache-flink")
    expect(kafka?.resources.some((resource) => resource.ref === "mcp:confluent")).toBeTrue()
    expect(flink?.resources.some((resource) => resource.ref === "mcp:confluent")).toBeTrue()
    expect(
      resources.filter((resource) => resource.source === "https://github.com/confluentinc/mcp-confluent"),
    ).toHaveLength(1)
  })

  test("keeps community and unstable Skills disabled by default", () => {
    for (const technology of data.technologies) {
      for (const association of technology.resources) {
        if (
          association.ref.startsWith("skill:") &&
          (association.trust !== "official" || association.maturity !== "stable")
        ) {
          expect(association.default, association.ref).toBeFalse()
        }
      }
    }
  })

  test("all snapshot associations carry curated:true", () => {
    for (const technology of data.technologies) {
      for (const association of technology.resources) {
        expect(association.curated, association.ref).toBeTrue()
      }
    }
  })

  test("defaults stable official Skills and MCP servers, deduplicating shared resources", () => {
    const selected = [Stack.TechnologyID.make("apache-airflow"), Stack.TechnologyID.make("astronomer")]
    const refs = defaults(builtin, selected)
    expect(refs.filter((ref) => ref === "skill:airflow")).toHaveLength(1)
    for (const ref of defaults(
      builtin,
      data.technologies.map((technology) => technology.id),
    )) {
      const resource = resources.find((item) => item.ref === ref)
      expect(resource).toBeDefined()
      expect(resource && defaultable(resource)).toBeTrue()
    }
  })

  test("carries source, trust, maturity, and warnings on every association", () => {
    const index = new Map(resources.map((resource) => [resource.ref, resource]))
    for (const technology of data.technologies) {
      for (const association of technology.resources) {
        const resource = index.get(association.ref)
        expect(resource).toBeDefined()
        expect(association.source.startsWith("https://")).toBeTrue()
        expect(association.rationale.length).toBeGreaterThan(0)
        expect(association).toMatchObject({
          trust: resource?.trust,
          maturity: resource?.maturity,
          source: resource?.source,
          warnings: resource?.warnings,
        })
      }
    }
  })

  test("does not warn about mutable discovery sources", () => {
    expect(resources.flatMap((resource) => resource.warnings)).not.toContain(
      "Discovery source is mutable; Marketplace installation must pin an immutable revision and digest.",
    )
  })
})

describe("catalog invariants", () => {
  test("accepts the built-in catalog", () => {
    expect(validate(builtin, expected)).toEqual([])
  })

  test("reports colliding IDs", () => {
    const catalog = {
      ...builtin,
      resources: [...builtin.resources, builtin.resources[0]],
      verticals: [{ ...data, technologies: [...data.technologies, data.technologies[0]] }],
    }
    const codes = validate(catalog, expected).map((issue) => issue.code)
    expect(codes).toContain("resource_id_collision")
    expect(codes).toContain("technology_id_collision")
  })

  test("reports unsafe defaults and duplicate expected Marketplace IDs", () => {
    const technology = data.technologies.find((item) => item.id === "apache-kafka")
    if (!technology) throw new Error("Apache Kafka fixture is missing")
    const vertical = {
      ...data,
      technologies: data.technologies.map((item) =>
        item.id === technology.id
          ? {
              ...item,
              resources: item.resources.map((resource) =>
                resource.ref === "skill:kafka-streams-programming" ? { ...resource, default: true } : resource,
              ),
            }
          : item,
      ),
    }
    expect(validate({ ...builtin, verticals: [vertical] }, expected).map((issue) => issue.code)).toContain(
      "unsafe_default",
    )
    expect(validate(builtin, [...expected, expected[0]]).map((issue) => issue.code)).toContain(
      "expected_resource_collision",
    )
  })

  test("reports unsafe defaults for non-curated associations with default:true on defaultable resources", () => {
    // An advisory (curated:false) association must not be allowed to set default=true
    // on even a stable first-party skill or MCP — only curated associations may do so.
    const technology = data.technologies.find((item) => item.id === "dbt")
    if (!technology) throw new Error("dbt fixture is missing")
    const mcpAssoc = technology.resources.find((r) => r.ref === "mcp:dbt")
    if (!mcpAssoc) throw new Error("mcp:dbt association is missing")
    const vertical = {
      ...data,
      technologies: data.technologies.map((item) =>
        item.id === "dbt"
          ? {
              ...item,
              resources: item.resources.map((r) =>
                r.ref === "mcp:dbt" ? { ...r, default: true, curated: false } : r,
              ),
            }
          : item,
      ),
    }
    expect(validate({ ...builtin, verticals: [vertical] }, expected).map((issue) => issue.code)).toContain(
      "unsafe_default",
    )
  })

  test("reports placements that reference missing technologies", () => {
    const category = data.categories[0]
    const vertical = {
      ...data,
      categories: [
        {
          ...category,
          technologies: [...category.technologies, { technology: Stack.TechnologyID.make("missing-technology") }],
        },
        ...data.categories.slice(1),
      ],
    }
    expect(validate({ ...builtin, verticals: [vertical] }, expected).map((issue) => issue.code)).toContain(
      "missing_technology",
    )
  })

  test("reports defaults that reference missing resources", () => {
    const technology = data.technologies[0]
    const vertical = {
      ...data,
      technologies: [
        {
          ...technology,
          resources: [
            ...technology.resources,
            {
              ...technology.resources[0],
              ref: Stack.ResourceRef.make("skill:missing-resource"),
              default: true,
            },
          ],
        },
        ...data.technologies.slice(1),
      ],
    }
    expect(validate({ ...builtin, verticals: [vertical] }, expected).map((issue) => issue.code)).toContain(
      "missing_resource",
    )
  })

  test("reports expected Marketplace manifest drift", () => {
    const removed = validate(builtin, expected.slice(1)).map((issue) => issue.code)
    const added = validate(builtin, [...expected, Stack.ResourceRef.make("skill:missing-resource")]).map(
      (issue) => issue.code,
    )
    expect(removed).toContain("unexpected_resource")
    expect(added).toContain("expected_resource_missing")
  })
})

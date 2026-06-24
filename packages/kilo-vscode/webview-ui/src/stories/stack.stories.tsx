/** @jsxImportSource solid-js */
/**
 * Stories for the project Stack Builder panel.
 */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { StoryProviders } from "./StoryProviders"
import { StackProvider, type StackFixture } from "../context/stack"
import { StackWizard } from "../components/stack"
import type { StackApplyFailure, StackLoadData, StackMcpItem, StackPlan } from "../types/stack"
import "../components/stack/stack.css"

const meta: Meta = {
  title: "StackBuilder",
  parameters: { layout: "fullscreen" },
}
export default meta
type Story = StoryObj

const skill = {
  ref: "skill:dbt",
  id: "dbt",
  kind: "skill" as const,
  name: "dbt Analytics Engineering",
  trust: "official" as const,
  maturity: "stable" as const,
  source: "source",
  warnings: [],
}
const mcp = {
  ref: "mcp:airflow",
  id: "airflow",
  kind: "mcp" as const,
  name: "Airflow MCP",
  trust: "community" as const,
  maturity: "preview" as const,
  source: "source",
  warnings: ["Audit this community resource before installation."],
}
const mcpItem: StackMcpItem = {
  id: "airflow",
  version: "1.2.0",
  source_revision: "a".repeat(40),
  name: "Airflow MCP",
  description: "Inspect and operate Apache Airflow through Marketplace-managed MCP methods.",
  publisher: { id: "airflow-community", name: "Airflow Community", trust: "community" },
  maturity: "preview",
  support: "community",
  source_url: "https://github.com/example/airflow-mcp",
  installability: { installable: true },
  tags: ["airflow", "orchestration"],
  kind: "mcp",
  methods: [
    {
      id: "remote",
      name: "Hosted API",
      template: {
        type: "remote",
        url: "{param:base_url}/mcp",
        headers: { Authorization: "Bearer {env:AIRFLOW_API_TOKEN}" },
        enabled: false,
      },
      parameters: [
        {
          id: "base_url",
          name: "Airflow URL",
          description: "HTTPS endpoint for the Airflow deployment.",
          type: "url",
          required: true,
          sensitive: false,
          default: "https://airflow.example.com",
        },
        {
          id: "region",
          name: "Region",
          description: "Hosted control-plane region.",
          type: "string",
          required: true,
          sensitive: false,
          default: "us-east-1",
          allowed_values: ["us-east-1", "eu-west-1"],
        },
        {
          id: "token",
          name: "API token",
          type: "string",
          required: true,
          sensitive: true,
          environment: "AIRFLOW_API_TOKEN",
        },
      ],
      prerequisites: ["Allow HTTPS access to the Airflow deployment."],
      platforms: ["darwin", "linux"],
      auth: { mode: "environment", environment: ["AIRFLOW_API_TOKEN"] },
      warnings: { writes: true, text: "This method can trigger and modify Airflow DAG runs." },
    },
    {
      id: "local",
      name: "Local uvx",
      template: {
        type: "local",
        command: ["uvx", "airflow-mcp", "--project", "{param:project_dir}"],
        environment: { AIRFLOW_API_TOKEN: "{env:AIRFLOW_API_TOKEN}" },
        enabled: false,
      },
      parameters: [
        {
          id: "project_dir",
          name: "Project directory",
          type: "path",
          required: true,
          sensitive: false,
          default: ".",
        },
        {
          id: "token",
          name: "API token",
          type: "string",
          required: true,
          sensitive: true,
          environment: "AIRFLOW_API_TOKEN",
        },
      ],
      prerequisites: ["Install uv."],
      platforms: ["darwin", "linux", "win32"],
      auth: { mode: "environment", environment: ["AIRFLOW_API_TOKEN"] },
      warnings: { writes: false },
    },
  ],
}
const skillAssociation = {
  ref: skill.ref,
  default: true,
  trust: skill.trust,
  maturity: skill.maturity,
  source: skill.source,
  rationale: "Stable official Skill recommended for analytics engineering.",
  warnings: [],
}
const mcpAssociation = {
  ref: mcp.ref,
  default: false,
  trust: mcp.trust,
  maturity: mcp.maturity,
  source: mcp.source,
  rationale: "Optional MCP candidate requiring separate installation consent.",
  warnings: mcp.warnings,
}

const data: StackLoadData = {
  catalog: {
    catalog: {
      revision: "2026-06-22.1",
      verticals: [
        {
          id: "data",
          name: "Data Engineering",
          technologies: [
            { id: "airflow", name: "Apache Airflow", resources: [mcpAssociation] },
            { id: "dbt", name: "dbt", resources: [skillAssociation] },
          ],
          categories: [
            {
              id: "engineering",
              name: "Engineering",
              technologies: [],
              categories: [
                {
                  id: "orchestration",
                  name: "Orchestration",
                  technologies: [{ technology: "airflow", note: "Coordinate scheduled data workflows." }],
                  categories: [],
                },
                {
                  id: "transformation",
                  name: "Transformation",
                  technologies: [{ technology: "dbt", note: "Model and test analytical datasets." }],
                  categories: [],
                },
              ],
            },
          ],
        },
      ],
      resources: [skill, mcp],
    },
    resources: [
      { resource: skill, availability: "available" },
      { resource: mcp, availability: "available", item: mcpItem },
    ],
    expected_resources: [skill.ref, mcp.ref],
  },
  state: {
    draft: {
      verticals: { data: { technologies: ["airflow", "dbt"] } },
      resources: {
        "mcp:airflow": {
          enabled: true,
          method: "remote",
          parameters: { base_url: "https://airflow.example.com", region: "us-east-1" },
        },
      },
    },
    resources: [
      { resource: skill.ref, enabled: true, managed: false, inherited: false, drift: "desired" },
      { resource: mcp.ref, enabled: true, managed: true, inherited: false, drift: "none" },
    ],
    conflicts: [],
    config_revision: "sha256:config",
    catalog_revision: "2026-06-22.1",
  },
}

const plan: StackPlan = {
  draft: data.state.draft,
  plan_hash: "sha256:9bd6319e12b42db7f032b7af71ef66a54a21ef2e67d0a55f4c8ab6e95ef0ce51",
  config_revision: "sha256:config",
  catalog_revision: "2026-06-22.1",
  actions: [
    {
      resource: skill.ref,
      action: "install",
      reason: "Selected by dbt and not currently installed in this project.",
      technologies: ["dbt"],
      warnings: [],
      prerequisites: [],
    },
    {
      resource: mcp.ref,
      action: "blocked",
      reason: "The selected Marketplace installation method is unavailable.",
      technologies: ["airflow"],
      warnings: ["Confirmation is disabled until this resource is installable or deselected."],
      prerequisites: [],
    },
  ],
  conflicts: [
    {
      code: "invalid_draft",
      message: "The selected Marketplace installation method is unavailable.",
      resource: mcp.ref,
      action: "blocked",
    },
  ],
  warnings: ["MCP servers are installed disabled until enabled in MCP settings."],
  prerequisites: ["Set environment variable AIRFLOW_API_TOKEN."],
}

const readyPlan: StackPlan = {
  ...plan,
  actions: plan.actions.filter((action) => action.action !== "blocked"),
  conflicts: [],
}

const failure: StackApplyFailure = {
  code: "apply_failed",
  message: "Stack changes could not be applied.",
  rollback: true,
  results: [
    {
      resource: skill.ref,
      action: "install",
      success: false,
      message: "The verified artifact could not be moved into the project.",
    },
  ],
}

function render(fixture: StackFixture) {
  return (
    <StoryProviders noPadding>
      <StackProvider fixture={fixture}>
        <div style={{ "max-height": "720px", overflow: "auto" }}>
          <StackWizard />
        </div>
      </StackProvider>
    </StoryProviders>
  )
}

export const CategorySelection: Story = {
  name: "Category — multi-select technologies",
  render: () => render({ data, project: true, step: "category" }),
}

export const ResourceConfiguration: Story = {
  name: "Resources — explicit MCP method and warnings",
  render: () => render({ data, project: true, step: "resources" }),
}

export const McpMethodRequired: Story = {
  name: "Resources — MCP method required",
  render: () =>
    render({
      data: {
        ...data,
        state: {
          ...data.state,
          draft: {
            ...data.state.draft,
            resources: { ...data.state.draft.resources, [mcp.ref]: { enabled: true } },
          },
        },
      },
      project: true,
      step: "resources",
      issues: [{ code: "method_required", resource: mcp.ref, resourceName: mcp.name }],
    }),
}

export const InstallRemoveReview: Story = {
  name: "Review — actions and blocking conflicts",
  render: () => render({ data, project: true, step: "review", plan }),
}

export const ExactPlanReady: Story = {
  name: "Review — exact plan ready to apply",
  render: () => render({ data, project: true, step: "review", plan: readyPlan }),
}

export const ApplyingProgress: Story = {
  name: "Review — transactional apply progress",
  render: () => render({ data, project: true, step: "review", plan: readyPlan, busy: "apply" }),
}

export const FailedResult: Story = {
  name: "Result — failed action announcement",
  render: () => render({ data, project: true, step: "result", failure }),
}

export const DriftConflict: Story = {
  name: "Review — stale plan and project drift",
  render: () =>
    render({
      data: {
        ...data,
        state: {
          ...data.state,
          resources: data.state.resources.map((resource) =>
            resource.resource === skill.ref ? { ...resource, drift: "modified" as const } : resource,
          ),
        },
      },
      project: true,
      step: "review",
      plan,
      stale: true,
    }),
}

export const CatalogNotReady: Story = {
  name: "Vertical — catalog coverage not ready",
  render: () =>
    render({
      data: {
        ...data,
        catalog: {
          ...data.catalog,
          resources: data.catalog.resources.map((summary) =>
            summary.resource.ref === mcp.ref
              ? { ...summary, availability: "missing" as const, reason: "Resource is absent from Marketplace." }
              : summary,
          ),
        },
      },
      project: true,
    }),
}

export const ProjectRequired: Story = {
  name: "Empty — project required",
  render: () => render({ project: false }),
}

export const EmptyCatalog: Story = {
  name: "Empty — no catalog verticals",
  render: () =>
    render({
      project: true,
      data: {
        catalog: {
          catalog: { revision: "2026-06-22.1", verticals: [], resources: [] },
          resources: [],
          expected_resources: [],
        },
        state: {
          draft: { verticals: {}, resources: {} },
          resources: [],
          conflicts: [],
          config_revision: "sha256:config",
          catalog_revision: "2026-06-22.1",
        },
      },
    }),
}

export const LoadError: Story = {
  name: "Error — Marketplace catalog unavailable",
  render: () =>
    render({ project: true, error: "The Stack catalog is unavailable. Try again when the Kilo backend is online." }),
}

export const CategorySelection200: Story = {
  name: "Category — narrow 200px",
  render: () => render({ data, project: true, step: "category" }),
}

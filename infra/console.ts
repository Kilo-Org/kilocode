import { domain } from "./stage"
import { EMAILOCTOPUS_API_KEY } from "./app"
import { SECRET } from "./secret"

// Preview stages have no new Console or inference deployment to forward to.
const migrationDomain =
  $app.stage === "production" ? "opencode.ai" : $app.stage === "dev" ? "dev.opencode.ai" : undefined
const consoleMigration = new sst.Linkable("ConsoleMigration", {
  properties: {
    consoleUrl: migrationDomain ? `https://${migrationDomain}/console` : "",
    inferenceUrl: migrationDomain ? `https://${migrationDomain}/inference` : "",
  },
})

////////////////
// CONSOLE
////////////////

// Archived Zen request/response dumps (writer removed May 2026). Retained on purpose; nothing reads or writes them.
new sst.cloudflare.Bucket("ZenData")
new sst.cloudflare.Bucket("ZenDataNew")

const DISCORD_INCIDENT_WEBHOOK_URL = new sst.Secret("DISCORD_INCIDENT_WEBHOOK_URL")
const AWS_SES_ACCESS_KEY_ID = new sst.Secret("AWS_SES_ACCESS_KEY_ID")
const AWS_SES_SECRET_ACCESS_KEY = new sst.Secret("AWS_SES_SECRET_ACCESS_KEY")
const ENTERPRISE_SALES_INBOX_EMAIL = new sst.Secret("ENTERPRISE_SALES_INBOX_EMAIL")

const SALESFORCE_CLIENT_ID = new sst.Secret("SALESFORCE_CLIENT_ID")
const SALESFORCE_CLIENT_SECRET = new sst.Secret("SALESFORCE_CLIENT_SECRET")
const SALESFORCE_INSTANCE_URL = new sst.Secret("SALESFORCE_INSTANCE_URL")
const CONSOLE_CRM_TOKEN = new sst.Secret("CONSOLE_CRM_TOKEN")
const CONSOLE_CRM_LOOKUP_URL = new sst.Linkable("CONSOLE_CRM_LOOKUP_URL", {
  properties: { value: `https://${domain}/console/api/internal/console-account` },
})

const logProcessor = new sst.cloudflare.Worker("LogProcessor", {
  handler: "packages/console/function/src/log-processor.ts",
  link: [SECRET.HoneycombApiKey],
})

new sst.cloudflare.x.SolidStart("Console", {
  domain,
  path: "packages/console/app",
  link: [
    consoleMigration,
    DISCORD_INCIDENT_WEBHOOK_URL,
    SECRET.HoneycombWebhookSecret,
    EMAILOCTOPUS_API_KEY,
    AWS_SES_ACCESS_KEY_ID,
    AWS_SES_SECRET_ACCESS_KEY,
    ENTERPRISE_SALES_INBOX_EMAIL,
    SALESFORCE_CLIENT_ID,
    SALESFORCE_CLIENT_SECRET,
    SALESFORCE_INSTANCE_URL,
    CONSOLE_CRM_TOKEN,
    CONSOLE_CRM_LOOKUP_URL,
  ],
  environment: {
    //VITE_DOCS_URL: web.url.apply((url) => url!),
    //VITE_API_URL: gateway.url.apply((url) => url!),
    VITE_CONSOLE_MARKETING_ENABLED: $app.stage === "dev" ? "true" : "false",
  },
  transform: {
    server: {
      placement: { region: "aws:us-east-2" },
      transform: {
        worker: (args) => {
          args.compatibilityFlags = $resolve(args.compatibilityFlags).apply((flags) => [
            ...(flags ?? []),
            "global_fetch_strictly_public",
          ])
          // Same-zone fetch to inference re-enters as a public request and loses the client IP.
          if (migrationDomain)
            args.bindings = $resolve(args.bindings).apply((bindings) => [
              ...(bindings ?? []),
              { type: "service", name: "INFERENCE", service: `opencode-inference-${$app.stage}` },
            ])
          args.tailConsumers = [{ service: logProcessor.nodes.worker.scriptName }]
        },
      },
    },
  },
})

import type { Hooks, PluginInput } from "@kilocode/plugin"

export async function AzureAuthPlugin(_input: PluginInput): Promise<Hooks> {
  const prompts = []
  // kilocode_change start - allow configuring either Azure resource name or full endpoint URL from the UI
  const hasResource = process.env.AZURE_RESOURCE_NAME || process.env.AZURE_OPENAI_RESOURCE_NAME
  const hasEndpoint = process.env.AZURE_OPENAI_ENDPOINT
  if (!hasResource && !hasEndpoint) {
    prompts.push({
      type: "select" as const,
      key: "endpointType",
      message: "Select Azure endpoint configuration",
      options: [
        {
          label: "Resource name",
          value: "resourceName",
          hint: "Build the endpoint from your Azure resource name",
        },
        {
          label: "Full endpoint URL",
          value: "baseURL",
          hint: "Use a custom Azure OpenAI endpoint",
        },
      ],
    })
    prompts.push({
      type: "text" as const,
      key: "resourceName",
      message: "Enter Azure Resource Name",
      placeholder: "e.g. my-models",
      when: { key: "endpointType", op: "eq" as const, value: "resourceName" },
    })
    prompts.push({
      type: "text" as const,
      key: "baseURL",
      message: "Enter Azure OpenAI endpoint URL",
      placeholder: "e.g. https://my-models.openai.azure.com/openai",
      when: { key: "endpointType", op: "eq" as const, value: "baseURL" },
    })
  }
  // kilocode_change end

  return {
    auth: {
      provider: "azure",
      methods: [
        {
          type: "api",
          label: "API key",
          prompts,
        },
      ],
    },
  }
}

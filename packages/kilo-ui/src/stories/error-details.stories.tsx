/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import type { AssistantMessage } from "@kilocode/sdk/v2"
import type { UiI18nKey, UiI18nParams } from "@opencode-ai/ui/context/i18n"
import { I18nProvider } from "@opencode-ai/ui/context/i18n"
import { Card } from "@opencode-ai/ui/card"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { ErrorDetails } from "../components/error-details"

type ErrorType = NonNullable<AssistantMessage["error"]>

const labels: Record<string, string> = {
  "error.details.show": "Details",
}

const i18nValue = {
  locale: () => "en",
  t: (key: UiI18nKey, _params?: UiI18nParams) => labels[key] ?? key,
}

const apiError: ErrorType = {
  name: "APIError",
  data: {
    message: "Request failed: 429 Too Many Requests",
    statusCode: 429,
    isRetryable: true,
    responseBody: JSON.stringify(
      {
        error: {
          type: "rate_limit_error",
          message: "You have exceeded the rate limit. Please try again in 30 seconds.",
        },
      },
      null,
      2,
    ),
    metadata: { "x-request-id": "req_01abc123", region: "us-east-1" },
  },
}

function ErrorCard(props: { error: ErrorType; defaultOpen?: boolean }) {
  const message =
    "data" in props.error && typeof props.error.data === "object" && "message" in props.error.data
      ? String(props.error.data.message)
      : props.error.name

  return (
    <I18nProvider value={i18nValue}>
      <div style={{ width: "600px" }}>
        <Card variant="error" class="error-card">
          <div>{message}</div>
          <Collapsible variant="ghost" defaultOpen={props.defaultOpen}>
            <Collapsible.Trigger class="error-details-trigger">
              <span>Details</span>
              <Collapsible.Arrow />
            </Collapsible.Trigger>
            <Collapsible.Content>
              <ErrorDetails error={props.error} />
            </Collapsible.Content>
          </Collapsible>
        </Card>
      </div>
    </I18nProvider>
  )
}

const meta: Meta = {
  title: "Components/ErrorDetails",
  parameters: { layout: "padded" },
}

export default meta
type Story = StoryObj

export const Collapsed: Story = {
  name: "Collapsed",
  render: () => <ErrorCard error={apiError} />,
}

export const Expanded: Story = {
  name: "Expanded",
  render: () => <ErrorCard defaultOpen error={apiError} />,
}

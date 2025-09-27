---
sidebar_label: Provider Defined
---

# Provider Defined Integrations

Kilo Code supports a "Provider Defined" integration that lets you onboard any OpenAI-compatible service by loading the provider's manifest and model definitions directly from the provider or from a JSON snippet they provide. This removes the need for Kilo Code to ship per-provider updates and allows providers to keep their information fresh.

## Quick Overview

There are two primary ways to configure a Provider Defined integration:

1. **Hosted Manifest** – The provider exposes OpenAI-style endpoints (manifest + extended models). You only need the manifest URL.
2. **Embedded JSON** – The provider gives you a raw JSON payload containing the manifest and model data. Paste it directly into Kilo Code and parse it locally (no HTTP fetch required).

Both approaches ultimately produce the same model list and metadata inside Kilo Code.

---

## Configuring in Kilo Code (User Guide)

1. Open Kilo Code settings and select **Provider Defined** in the provider dropdown.
2. Choose your **Model Source**:
    - **Manifest URL** – Enter the provider's manifest endpoint (typically `https://providername.com/v1/models?provider=true`). Click **Fetch** to retrieve the manifest and extended models.
    - **Embedded JSON** – Paste the embedded JSON payload supplied by the provider. Click **Parse** to load the manifest and models.
3. Provide an **API Key** if the provider requires authentication.
4. Choose your model from the dropdown that appears after a successful fetch/parse.
5. Save your configuration. You're ready to use the provider in chats.

### Example Manifest Workflow

1. Select **Manifest URL**.
2. Enter `https://api.synthetic.new/openai/v1/models?provider=true`.
3. Click **Fetch**. On success, the model dropdown populates with the provider's models (see the example below).

### Example Embedded JSON Workflow

1. Select **Embedded JSON**.
2. Paste the JSON block provided by the provider.
3. Click **Parse**. On success, the model dropdown populates without contacting any external endpoint.

---

## Example Data Provided by a Provider

### Hosted Manifest & Extended Models

Providers implementing the hosted approach expose two endpoints:

- **Manifest**: `GET /v1/models?provider=true`
- **Extended Models**: `GET /v1/models?extended=true`

Example manifest response:

```json
{
	"name": "Sample Provider",
	"website": "https://providerwebsite.com",
	"baseUrl": "https://providerwebsite.com/v1",
	"models_data_source": "endpoint"
}
```

Example extended models response:

```json
{
	"models": {
		"provider/model-name-v1": {
			"id": "provider/model-name-v1",
			"name": "Model Name V1",
			"attachment": false,
			"reasoning": true,
			"temperature": true,
			"tool_call": true,
			"release_date": "2025-08-21",
			"last_updated": "2025-08-21",
			"modalities": { "input": ["text", "image"], "output": ["text"] },
			"open_weights": false,
			"cost": { "input": 0.5, "output": 1.5 },
			"limit": { "context": 128000, "output": 4096 }
		},
		"provider/another-model-v2": {
			"id": "provider/another-model-v2",
			"name": "Another Model V2"
		}
	}
}
```

### Embedded JSON

If hosting endpoints is not feasible, providers can assemble a JSON array containing the manifest and extended models responses. Users can paste this unchanged into Kilo Code when **Embedded JSON** is selected.

```json
[
	{
		"name": "Synthetic",
		"website": "https://providerwebsite.com",
		"baseUrl": "https://providerwebsite.com/v1",
		"models_data_source": "embedded"
	},
	{
		"models": {
			"provider/model-name-v1": {
				"id": "provider/model-name-v1",
				"name": "Model Name V1",
				"attachment": false,
				"reasoning": true,
				"temperature": true,
				"tool_call": true,
				"release_date": "2025-08-21",
				"last_updated": "2025-08-21",
				"modalities": { "input": ["text", "image"], "output": ["text"] },
				"open_weights": false,
				"cost": { "input": 0.5, "output": 1.5 },
				"limit": { "context": 128000, "output": 4096 }
			},
			"provider/another-model-v2": {
				"id": "provider/another-model-v2",
				"name": "Another Model V2"
			}
		}
	}
]
```

This JSON mirrors the two hosted responses in one payload (index `0` is the manifest, index `1` is the model info).

---

## Guidance for Providers

To support Kilo Code's Provider Defined integration, you can choose between hosting endpoints or distributing embedded JSON.

### Option 1: Host Endpoints (Recommended)

1. **Manifest Endpoint** – `GET /v1/models?provider=true`

    Fields:

    - `name`: Display name for the provider.
    - `website`: Link to your main site.
    - `baseUrl`: Base URL for OpenAI-compatible requests. Kilo Code will call `/chat/completions`, `/models`, etc. relative to this.
    - `models_data_source`: Must be `"endpoint"` or `"models_dev"`.
        - If `models_dev` is returns, you must provide `models_dev_provider_id` for lookup.
        - If `endpoint` is selected, Kilo Code will retrieve `{baseUrl}/models?extended=true` to retrieve the detailed model parameters.
    - `models_dev_provider_id` (optional): Provide when using the `models_dev` option. If you already keep [models.dev](https://models.dev/) up to date with your hosted model details, Kilo Code can simply fetch the data.

2. **Extended Models Endpoint** – `GET /v1/models?extended=true`

    Returns detailed metadata for each model including pricing, capabilities, and context limits. See the JSON examples above for the recommended schema.

### Option 2: Provide Embedded JSON

1. Build the manifest object using the same fields as your hosted manifest. Set `"models_data_source": "embedded"`.
2. Collect your extended model data (same as the `/v1/models?extended=true` response).
3. Combine them into a two-element JSON array: `[manifestObject, extendedModelsObject]`.
4. Distribute this JSON to your users (e.g., publish a readme snippet). Users can paste it directly into Kilo Code.

### Choosing a Strategy

- **Hosted endpoints** are ideal if you can maintain them—users get updates automatically.
- **Embedded JSON** is perfect when you cannot host a live service yet or want a lightweight onboarding path.
- You can start with embedded JSON and graduate to hosted endpoints later.

### Testing Tips

- Use Kilo Code's "Provider Defined" settings with the new data source toggle to confirm the manifest/JSON loads properly.
- If hosting endpoints, verify they respond quickly and use the same schema as OpenAI's `/models` endpoints.
- Make sure your base URL is routable and includes any necessary API versioning (e.g., `https://api.provider.com/v1`).

---

## Troubleshooting

| Issue                                                      | Possible Cause                                                                            | Suggested Fix                                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Fetch fails with "Provide a manifest URL or embedded JSON" | No manifest URL and no embedded JSON were provided                                        | Enter a manifest URL when using the Manifest source, or paste embedded JSON and choose Embedded |
| Fetch returns "Failed to process provider data"            | Manifest or embedded JSON is malformed, missing fields, or the endpoint returned an error | Double-check the payload matches the examples above, ensure `models_data_source` is correct     |
| Models dropdown empty after fetch                          | Provider returned no models                                                               | Confirm your extended models payload contains a `models` object with at least one model         |
| Requests to `/chat/completions` fail                       | `baseUrl` incorrect or API key missing                                                    | Verify the manifest's `baseUrl` and that the user has entered an API key                        |

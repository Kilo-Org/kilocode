# OpenAI Compatible Test Server

This is a simple test server that mimics the OpenAI API for testing the Virtual Quota Fallback Handler. It occasionally returns 429 errors at a configurable rate to verify that the fallback mechanism works correctly.

## Usage

To start the server with the default error rate (10%):

```bash
npx tsx openai-test-server.ts
```

To start the server with a custom error rate:

```bash
npx tsx openai-test-server.ts --error-rate 0.3
```

The error rate should be a decimal between 0 and 1, where 0 means no errors and 1 means all requests will return 429 errors.

## Endpoints

- `GET /` - Server status
- `GET /v1/models` - List available models
- `POST /v1/chat/completions` - Chat completions (supports both regular and streaming responses)

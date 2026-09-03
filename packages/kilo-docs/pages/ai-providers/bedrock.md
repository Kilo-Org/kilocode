---
title: "Using AWS Bedrock with Kilo Code"
description: "Configure AWS Bedrock in Kilo Code to access Claude, Llama, and other foundation models through your AWS account."
sidebar_label: AWS Bedrock
---

# Using AWS Bedrock With Kilo Code

Kilo Code supports accessing models through Amazon Bedrock, a fully managed service that makes a selection of high-performing foundation models (FMs) from leading AI companies available via a single API. This provider connects directly to AWS Bedrock and authenticates with the provided credentials.

**Website:** [https://aws.amazon.com/bedrock/](https://aws.amazon.com/bedrock/)

## Prerequisites

- **AWS Account:** You need an active AWS account.
- **Bedrock Access:** You must request and be granted access to Amazon Bedrock. See the [AWS Bedrock documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/getting-started.html) for details on requesting access.
- **Model Access:** Within Bedrock, you need to request access to the specific models you want to use (e.g., Anthropic Claude).
- **AWS CLI (profile authentication only):** If you plan to use an AWS profile, install AWS CLI and configure your credentials:
  ```bash
  aws configure
  ```

## Getting Credentials

You have three options for configuring AWS credentials:

1.  **Bedrock API Key:**
    - Create a Bedrock-specific API key in the AWS Console. This is a simple service-specific authentication method.
    - See the [AWS documentation on Bedrock credentials](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_bedrock.html) for instructions on creating an API key.
2.  **AWS Access Keys:**
    - Create an IAM user with the necessary permissions (at least `bedrock:InvokeModel`).
    - Generate an access key ID and secret access key for that user.
    - _(Optional)_ Create a session token if required by your IAM configuration.
3.  **AWS Profile:**
    - Configure an AWS profile using the AWS CLI or by manually editing your AWS credentials file. See the [AWS CLI documentation](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-profiles.html) for details.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode" %}

1. Open **Settings** and select **Providers**.
2. Find **Amazon Bedrock** and select **Connect**.
3. Choose an authentication method:
   - **AWS access keys:** Enter the AWS access key ID, AWS secret access key, optional AWS session token, and AWS region.
   - **Bedrock API key:** Enter a Bedrock API key.
4. Select **Submit**.

The extension stores these credentials in Kilo's credential store, not in `kilo.json`.

{% /tab %}
{% tab label="CLI" %}

Bedrock supports a Bedrock API key or the AWS credentials chain.

**Bedrock API key:**

```bash
export AWS_BEARER_TOKEN_BEDROCK="your-bedrock-api-key"
```

**AWS access key environment variables:**

```bash
export AWS_ACCESS_KEY_ID="your-access-key"
export AWS_SECRET_ACCESS_KEY="your-secret-key"
export AWS_SESSION_TOKEN="your-session-token" # Optional
export AWS_REGION="us-east-1"
```

Or use an AWS profile:

```bash
aws configure --profile bedrock
export AWS_PROFILE="bedrock"
```

**Config file** (`~/.config/kilo/kilo.json` or `./kilo.json`):

```jsonc
{
  "provider": {
    "amazon-bedrock": {},
  },
}
```

Then set your default model:

```jsonc
{
  "model": "amazon-bedrock/anthropic.claude-sonnet-4-20250514-v1:0",
}
```

{% /tab %}
{% /tabs %}

## Tips and Notes

- **Permissions:** Ensure your IAM user or role has the necessary permissions to invoke Bedrock models. The `bedrock:InvokeModel` permission is required.
- **Pricing:** Refer to the [Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/) page for details on model costs.
- **Cross-Region Inference:** Using cross-region inference may result in higher latency.

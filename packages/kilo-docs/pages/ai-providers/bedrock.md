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
- **Install AWS CLI:** Use AWS CLI to configure your account for authentication
  ```bash
   aws configure
  ```

## Getting Credentials

You have three options for configuring AWS credentials:

1.  **Bedrock API Key:**
    - Create a Bedrock-specific API key in the AWS Console. This is a simple service-specific authentication method.
    - See the [AWS documentation on Bedrock credentials](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_bedrock.html) for instructions on creating an API key.
2.  **AWS Access Keys (Recommended for Development):**
    - Create an IAM user with the necessary permissions (at least `bedrock:InvokeModel`).
    - Generate an access key ID and secret access key for that user.
    - _(Optional)_ Create a session token if required by your IAM configuration.
3.  **AWS Profile:**
    - Configure an AWS profile using the AWS CLI or by manually editing your AWS credentials file. See the [AWS CLI documentation](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-profiles.html) for details.

## Configuration in Kilo Code

{% tabs %}
{% tab label="VSCode (Legacy)" %}

1.  **Open Kilo Code Settings:** Click the gear icon ({% codicon name="gear" /%}) in the Kilo Code panel.
2.  **Select Provider:** Choose "Bedrock" from the "API Provider" dropdown.
3.  **Select Authentication Method:**
    - **Bedrock API Key:**
      - Enter your Bedrock API key directly. This is the simplest setup option.
    - **AWS Credentials:**
      - Enter your "AWS Access Key" and "AWS Secret Key."
      - (Optional) Enter your "AWS Session Token" if you're using temporary credentials.
    - **AWS Profile:**
      - Enter your "AWS Profile" name (e.g., "default").
4.  **Select Region:** Choose the AWS region where your Bedrock service is available (e.g., "us-east-1").
5.  **(Optional) Cross-Region Inference:** Check "Use cross-region inference" if you want to access models in a region different from your configured AWS region.
6.  **Select Model:** Choose your desired model from the "Model" dropdown.

{% /tab %}
{% tab label="VSCode" %}

Open **Settings** (gear icon) and go to the **Providers** tab to add AWS Bedrock. The extension uses the AWS credentials chain for authentication — configure your AWS credentials using the AWS CLI or environment variables before adding the provider.

The extension stores this in your `kilo.json` config file. You can also edit the config file directly — see the **CLI** tab for the file format.

{% /tab %}
{% tab label="CLI" %}

Bedrock uses the AWS credentials chain for authentication. Configure your AWS credentials using the AWS CLI or environment variables:

**Environment variables:**

```bash
export AWS_ACCESS_KEY_ID="your-access-key"
export AWS_SECRET_ACCESS_KEY="your-secret-key"
export AWS_REGION="us-east-1"
```

Or use an AWS profile:

```bash
aws configure --profile bedrock
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

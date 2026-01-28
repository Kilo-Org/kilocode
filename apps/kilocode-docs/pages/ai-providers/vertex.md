---
sidebar_label: GCP Vertex AI
---

# Using GCP Vertex AI With Kilo Code

Kilo Code supports accessing models through Google Cloud Platform's Vertex AI, a managed machine learning platform that provides access to various foundation models, including Anthropic's Claude family.

**Website:** [https://cloud.google.com/vertex-ai](https://cloud.google.com/vertex-ai)

## Prerequisites

- **Google Cloud Account:** You need an active Google Cloud Platform (GCP) account.
- **Project:** You need a GCP project with the Vertex AI API enabled.
- **Model Access:** You must request and be granted access to the specific Claude models on Vertex AI you want to use. See the [Google Cloud documentation](https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude#before_you_begin) for instructions.
- **Application Default Credentials (ADC):** Kilo Code uses Application Default Credentials to authenticate with Vertex AI. The easiest way to set this up is to:
    1.  Install the Google Cloud CLI: [https://cloud.google.com/sdk/docs/install](https://cloud.google.com/sdk/docs/install)
    2.  Authenticate using: `gcloud auth application-default login`
- **Service Account Key (Alternative):** Alternatively, you can authenticate using a Google Cloud Service Account key file. You'll need to generate this key in your GCP project. See the [Google Cloud documentation on creating service account keys](https://cloud.google.com/iam/docs/creating-managing-service-account-keys).

## Configuration in Kilo Code

1.  **Open Kilo Code Settings:** Click the gear icon ({% codicon name="gear" /%}) in the Kilo Code panel.
2.  **Select Provider:** Choose "GCP Vertex AI" from the "API Provider" dropdown.
3.  **Configure Authentication:**
    - **If using Application Default Credentials (ADC):** No further action is needed here. ADC will be used automatically if configured correctly (see Prerequisites).
    - **If _not_ using ADC (Service Account Key):**
        - **Option A: Paste JSON Content:** Paste the entire content of your Service Account JSON key file into the **Google Cloud Credentials** field.
        - **Option B: Provide File Path:** Enter the absolute path to your downloaded Service Account JSON key file in the **Google Cloud Key File Path** field.
4.  **Enter Project ID:** Enter your Google Cloud Project ID.
5.  **Select Region:** Choose the region where your Vertex AI resources are located (e.g., `us-east5`).
6.  **Select Model:** Choose your desired model from the "Model" dropdown.

## Tips and Notes

- **Permissions:** Ensure your Google Cloud account has the necessary permissions to access Vertex AI and the specific models you want to use.
- **Pricing:** Refer to the [Vertex AI pricing](https://cloud.google.com/vertex-ai/pricing) page for details.

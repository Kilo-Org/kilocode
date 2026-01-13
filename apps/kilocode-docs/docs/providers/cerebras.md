---
sidebar_label: Cerebras
---

# Using Cerebras With Kilo Code

Cerebras is known for their ultra-fast AI inference powered by the Cerebras CS-3 chip, the world's largest and fastest AI accelerator. Their platform delivers exceptional inference speeds for large language models, making them ideal for interactive development workflows.

**Website:** [https://cerebras.ai/](https://cerebras.ai/)

## Getting an API Key

1. **Sign Up/Sign In:** Go to the [Cerebras Cloud Platform](https://cloud.cerebras.ai/). Create an account or sign in.
2. **Navigate to API Keys:** Access the API Keys section in your account dashboard.
3. **Create a Key:** Click to generate a new API key. Give it a descriptive name (e.g., "Kilo Code").
4. **Copy the Key:** **Important:** Copy the API key _immediately_. Store it securely.

## Supported Models

Kilo Code supports the following Cerebras models:

- `gpt-oss-120b` (Default) – High-performance open-source model optimized for fast inference
- `zai-glm-4.6` – Fast general-purpose model on Cerebras (up to 1,000 tokens/s). To be deprecated soon.
- `zai-glm-4.7` – Highly capable general-purpose model on Cerebras (up to 1,000 tokens/s), competitive with leading proprietary models on coding tasks.

Refer to the [Cerebras documentation](https://docs.cerebras.ai/) for detailed information on model capabilities and performance characteristics.

## Configuration in Kilo Code

1. **Open Kilo Code Settings:** Click the gear icon (<Codicon name="gear" />) in the Kilo Code panel.
2. **Select Provider:** Choose "Cerebras" from the "API Provider" dropdown.
3. **Enter API Key:** Paste your Cerebras API key into the "Cerebras API Key" field.
4. **Select Model:** Choose your desired model from the "Model" dropdown.

## Tips and Notes

- **Inference Speed:** Cerebras models deliver some of the fastest inference speeds available, reducing wait times during development.
- **Open Source Models:** Many Cerebras models are based on open-source architectures, optimized for their custom hardware.
- **Cost Efficiency:** Fast inference can lead to better cost efficiency for interactive use cases.
- **Pricing:** Refer to the Cerebras platform for current pricing information and available plans.

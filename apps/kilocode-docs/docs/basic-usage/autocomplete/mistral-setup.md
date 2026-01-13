---
title: Setting Up Mistral for Free Autocomplete
sidebar_position: 1
---

# Setting Up Mistral for Free Autocomplete

This guide walks you through setting up Mistral's Codestral model for free autocomplete in Kilo Code. Mistral offers a free tier that's perfect for getting started with AI-powered code completions.

## Video Walkthrough

<video controls width="100%">
  <source src="/docs/videos/configure_free_codestral.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

## Step 1: Open Kilo Code Settings

In VS Code, open the Kilo Code panel and click the **Settings** icon (gear) in the top-right corner.

![Open Kilo Code Settings](./mistral-setup/01-open-kilo-code-settings.png)

## Step 2: Add a New Configuration Profile

Navigate to **Settings → Providers** and click **Add Profile** to create a new configuration profile for Mistral.

![Add Configuration Profile](./mistral-setup/02-add-configuration-profile.png)

## Step 3: Name Your Profile

In the "New Configuration Profile" dialog, enter a name like "Mistral profile" and click **Create Profile**.

![Create Mistral Profile](./mistral-setup/03-name-your-profile.png)

## Step 4: Select Mistral as Provider

In the **API Provider** dropdown, search for and select **Mistral**.

![Select Mistral Provider](./mistral-setup/04-select-mistral-provider.png)

## Step 5: Get Your API Key

You'll see a warning that you need a valid API key. Click **Get Mistral / Codestral API Key** to open the Mistral console.

![Get API Key Button](./mistral-setup/05-get-api-key.png)

## Step 6: Navigate to Codestral in Mistral AI Studio

In the Mistral AI Studio sidebar, click **Codestral** under the Code section.

![Select Codestral](./mistral-setup/06-navigate-to-codestral.png)

## Step 7: Generate API Key

Click the **Generate API Key** button to create your new Codestral API key.

![Confirm Generate](./mistral-setup/07-confirm-key-generation.png)

## Step 8: Copy Your API Key

Once generated, click the **copy** button next to your API key to copy it to your clipboard.

![Copy API Key](./mistral-setup/08-copy-api-key.png)

## Step 9: Paste API Key in Kilo Code

Return to Kilo Code settings and paste your API key into the **Mistral API Key** field.

![Paste API Key](./mistral-setup/09-paste-api-key.png)

## Step 10: Save Your Settings

Click **Save** to apply your Mistral configuration. You're now ready to use free autocomplete!

![Save Settings](./mistral-setup/10-save-settings.png)

## Next Steps

- Learn more about [Autocomplete features](./index.md)
- Explore [triggering options](./index.md#triggering-options) for autocomplete
- Check out [best practices](./index.md#best-practices) for optimal results

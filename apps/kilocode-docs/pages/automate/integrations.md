---
title: "Integrations"
description: "Overview of Kilo Code integrations"
---

# Kilo Code Integrations

Kilo Integrations lets you connect your GitHub account (and soon, GitLab and Bitbucket) to enable advanced features inside Kilo Code. Once connected, Kilo can access your repositories securely through the **KiloConnect** GitHub App, enabling features like **Cloud Agents** and **Kilo Deploy**.

## What You Can Do With Integrations

- **Connect GitHub to Kilo Code** in a few clicks
- **Authorize the KiloConnect App** for repo access
- **Enable advanced features** like Cloud Agents and Kilo Deploy

## Prerequisites

Before connecting:

- You must have a **GitHub account**.
- You need permission to install GitHub Apps for the repositories you want Kilo to access.
- (Optional) If you're connecting an organization, you must be an **org admin** or have app installation permissions.

## Connecting GitHub to Kilo

### 1. Open the Integrations Page

Go to your **Personal** or **Organization Dashboard**, and navigate to the [Integrations](https://app.kilo.ai/integrations) tab

### 2. Start the Connection Flow

1. Click **Configure** on the GitHub panel.
2. You’ll be redirected to GitHub to authorize the **KiloConnect** App.
3. Select the GitHub account or organization you want to connect.

### 3. Choose Repository Access

GitHub will ask which repositories you want Kilo to access:

- **All repositories** (recommended if you plan to use Cloud Agents or Deploy across multiple projects)
- **Only selected repositories** (choose specific repos)

Click **Install & Authorize** to continue.

### 4. Complete Authorization

Once approved:

- You’ll return to the Kilo Integrations page.
- Github will show a **Connected** status.
- Your Kilo workspace can now access GitHub repositories securely.

## What Happens After Connecting

Once GitHub is connected, the following features will be enabled in Kilo:

### Cloud Agents

- Run Kilo Code in the cloud from any device
- Auto-create branches and push work continuously
- Work from anywhere while keeping your repo in sync

### Kilo Deploy

- Deploy Next.js 14 & 15 apps directly from Kilo
- Trigger rebuilds automatically on push
- Manage deployment logs and history

### Upcoming:

- **GitLab Integration**
- **Bitbucket Integration**

---

## Managing or Removing the Integration

From the same **Integrations** page, you can click "Manage on Github" to:

- View the GitHub account you connected
- Update which repositories Kilo has access to
- Disconnect GitHub entirely
- Reauthorize the app if permissions change

---

## Troubleshooting

**“I don’t see my repositories.”**  
Ensure the KiloConnect App is installed for the correct GitHub org and that repo access includes the repositories you need.

**“My organization blocks third-party apps.”**  
You may need an admin to approve installing GitHub Apps.

**“Cloud Agents or Deploy can’t access my repo.”**  
Revisit the GitHub app settings and confirm the app has the correct repo scope.

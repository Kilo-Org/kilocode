---
title: Deploy
sidebar_label: Deploy
---

# Deploy

Kilo Deploy lets you ship **Next.js** applications directly from Kilo Code, with:

- **One-click deployment** from the Kilo Code dashboard
- **No manual configuration** — deployment settings are generated for you
- **Deployment history** with logs and build details
- **Automatic rebuilds** on every GitHub push

---

## Prerequisites

- Your project must use **Next.js 15** (all minor/patch versions) or the **latest minor of Next.js 14**
- You must enable the **GitHub Integration**
    - Go to **Integrations → GitHub**
    - Click **Configure** and follow the prompts to connect GitHub to Kilo Code

Deploy supports all major package managers: **npm, pnpm, yarn, bun**. Kilo Code automatically detects which one your project uses and runs the correct build command.

---

## Deploying Your App

### 1. Open the Deploy Tab

- Navigate to your [Organization dashboard](https://app.kilo.ai/organizations) or [Profile](https://app.kilo.ai/profile)
- Select the **Deploy** tab

### 2. Select Your Project

- Click **New Deployment**
- Choose **GitHub** in the Integration dropdown
- Select your repository and branch

<img width="600" height="443" alt="DeploySelection" src="https://github.com/user-attachments/assets/e592a7c1-a2dd-42e3-ba5d-d86d9b61001f" />

### 3. Click **Deploy**

Kilo Code will:

- Build your project
- Upload artifacts
- Provision your deployment
- Stream logs in real time

Once complete, you’ll receive a **deployment URL** you can open or share.

<img width="800" height="824" alt="DeploySuccess" src="https://github.com/user-attachments/assets/4a01ad52-1783-443f-9f9e-bfc2d4b77b43" />

---

## Deployment History & Rollbacks

Each deployment is saved automatically with:

- Timestamp
- Build logs
- Deployment URL (Preview/Production)

From the deployment details, you can:

- Inspect previous builds
- Redeploy
- Delete deployments

---

## Database Support

Kilo Deploy does **not** include built-in database hosting, but you can connect to any external database service.

---

## Environment Variables

Kilo Deploy supports Environment Variables and Secrets. Add the variable **key** and **value** during the **Create New Deployment** step, and toggle to mark as secrets.

## Common Use Cases

Deploy is ideal for:

1. **Quick prototypes** — instantly push an idea live
2. **Staging environments** — share a preview environment
3. **Rapid iteration** — push commits and get automatic rebuilds

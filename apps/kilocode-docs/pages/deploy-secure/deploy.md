---
title: "Deploy"
description: "Deploy your applications with Kilo Code"
---

# Deploy

Kilo Deploy lets you ship **Next.js** and **static sites** directly from Kilo Code, with:

- **One-click deployment** from the Kilo Code dashboard
- **No manual configuration** — deployment settings are generated for you
- **Deployment history** with logs and build details
- **Automatic rebuilds** on every GitHub push

---

## Supported Platforms

- **Next.js 14** — latest minor
- **Next.js 15** — all versions
- **Next.js 16** — partial support (some features may not work)
- **Static Sites** — pre-built HTML/CSS/JS
- **Static Site Generators** — Hugo, Jekyll, Eleventy (built during deployment)

**Package managers:** npm, pnpm, yarn, bun — automatically detected.

---

## Prerequisites

Enable the **GitHub Integration** before deploying:

1. Go to **Integrations → GitHub**
2. Click **Configure** and follow the prompts to connect GitHub to Kilo Code

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

---
title: "Conda Environments"
description: "Create, import, and manage conda environments and their packages from Kilo Desktop."
---

# Conda environments

Manage conda environments and their packages from within the app, so you can set up the Python environment your work needs without dropping to a separate terminal. You'll find **Conda Environments** in [Settings](/docs/desktop/settings/general#conda-environments), under **General**.

{% callout type="info" %}
Conda environments require a [Kilo account](/docs/desktop/settings/ai#ai-providers). Sign in to create and manage them.
{% /callout %}

## Why conda?

Scientific computing, machine learning, and AI work depends on more than Python packages. Libraries like NumPy, PyTorch, and TensorFlow rely on compiled code and native libraries — such as CUDA for GPUs, BLAS or MKL for linear algebra, and C, C++, and Fortran runtimes — that Python-only tools aren't designed to manage. Conda manages the full stack:

- **Beyond Python** — install native libraries, GPU toolkits, compilers, and packages for other languages such as R, alongside your Python packages. Conda manages the Python version itself, too.
- **Prebuilt binaries** — packages arrive precompiled for Windows, macOS, and Linux, so you don't need to build libraries from source or install developer tools.
- **Compatible dependencies** — conda's solver resolves the entire environment at once, so every package and native library it installs works together.
- **Isolation** — each conda environment is self-contained, so projects that need different versions of Python, PyTorch, or CUDA don't interfere with each other.
- **Reproducibility** — export an environment to an `environment.yml` file to recreate it on another machine or share it with a teammate.

To learn more, see [12 reasons to choose conda](https://www.anaconda.com/blog/12-reasons-to-choose-conda).

## Conda concepts

New to conda? Learn more about fundamental conda concepts in the official Anaconda documentation:

- **[Environment](https://www.anaconda.com/docs/getting-started/concepts/what-is-an-environment)** — an isolated set of packages (and a Python version) for a project.
- **[Package](https://www.anaconda.com/docs/getting-started/concepts/what-is-a-package)** — an installable library or tool.
- **[Channel](https://www.anaconda.com/docs/getting-started/concepts/what-is-a-channel)** — where packages are downloaded from.
- **[environment.yml](https://www.anaconda.com/docs/getting-started/working-with-conda/environments#sharing-an-environment)** — a file that describes an environment so it can be recreated or shared.

## Use a conda environment in your work

Managing a conda environment here doesn't automatically "activate" it — there's no activate switch in the app. Instead, the agent connects it to your work. Ask an agent to find an appropriate conda environment for a notebook and point the notebook at it, then restart the notebook so it picks up the change.

The most durable approach is to have the agent write an `environment.yml` into the workspace. The notebooks you already have, and any new ones you create there, then use that environment automatically. See [Notebooks](/docs/desktop/features/notebooks) for working with conda environments from a chat.

## Browse your conda environments

The page lists your conda environments by **name** and **prefix** (the full path on disk). Search by name or path, sort the list, and page through it. Click the {% svgIcon src="/docs/img/desktop/ellipsis.svg" /%} actions menu on an environment's row to **Clone** or **Delete** an environment. Select a row to open the environment and work with its packages.

## Create a conda environment

Click **New environment**, then select **Create New** to open the Create environment dialog.

On the Create environment page, configure your environment:

- **Location** — where the environment is created.
- **Name** — the environment's name.
- **Python version** — a specific version, or **Latest**.

Under **Select packages**, search the list and check the packages to include. Each package has a version dropdown (defaulting to **latest**), and your choices collect in the **Selected Packages** panel. Use the {% svgIcon src="/docs/img/desktop/list-filter.svg" /%} **Channels** control to choose where packages come from (see [Choose a channel](#choose-a-channel)). Select **Create Environment** to build it.

## Import from a file

Click **New environment**, then select **Import file** to open the Import from file dialog. Navigate to or drop a conda environment file (`.yml` or `.yaml`). Optionally set a **name override** to use instead of the name declared in the file.

## Work with a conda environment's packages

Selecting an environment opens its detail view. The header shows the environment name, its **Python** version, and the full prefix path. Below it, a table lists every installed package with its **Version**, **Source** (conda or pip), and **Channel**. Search by name and sort by any column.

### Update packages

When newer versions are available, an **Update** button appears. Click the **Update** button to open the Update dialog. From there, you can update all packages at once, or filter the table down to just the packages that you want to update. A **Dependency changes** panel previews what the update pulls in and flags any **dependency conflict** it can't resolve, so you can adjust your selection and try again. Turn on **Back up before updating** to clone the environment first, so you can roll back if needed.

Alternatively, on the packages table on the environment's details page, you can click the {% svgIcon src="/docs/img/desktop/ellipsis.svg" /%} actions menu on a package's row to **Update** or **Remove** just that one. **Update** is unavailable when a package is already at the latest available version.

### Add packages

From an open environment, select **+ Add Packages** to open the Add Packages dialog. Search for a package, and for each result pick a version (defaulting to **latest**). Your selections and their dependencies are added to the **Selected packages** list, and the {% svgIcon src="/docs/img/desktop/list-filter.svg" /%} **Channels** control sets where packages come from (see [Choose a channel](#choose-a-channel)).

Before anything is applied, the **Dependency changes** panel previews the dependency changes the solver will make — packages that will be upgraded, downgraded, added, removed, or rebuilt — so there are no surprises. Select **Install** to apply the changes. A long-running install can be sent to **Run in background** so you can keep working while it finishes.

## Choose a channel

When you select packages, you choose which channels they install from with the {% svgIcon src="/docs/img/desktop/list-filter.svg" /%} **Channels** control:

- **Anaconda `Main`** — secure, vetted packages; requires accepting Anaconda's terms of service.
- **conda-forge** — community-maintained and open-source.

Any channels configured in your conda settings appear here too.

---
title: "Conda Environments"
description: "Create, import, and manage conda environments and their packages from Kilo Desktop."
---

# Conda environments

Manage conda environments and their packages from within the app, so you can set up the Python environment your work needs without dropping to a separate terminal. You'll find **Conda Environments** in [Settings](/docs/desktop/settings/general#conda-environments), under **General**.

{% callout type="info" %}
Conda environments require a [Kilo account](/docs/desktop/settings/general#account). Sign in to create and manage them.

If you're signed out when the agent tries to use conda, the chat asks you to sign in (*Enable use of secure & governed Anaconda packages for Python environments?*). Select **Sign in** and the agent continues, or **Not now** to turn off the agent's conda tools until you sign in or restart the app. Other features still ask on their own.
{% /callout %}

While the conda backend starts up, the page shows *Starting the conda backend*. If loading fails, a **Try again** button appears.

## Why conda?

Scientific computing, machine learning, and AI work depends on more than Python packages. Libraries like NumPy, PyTorch, and TensorFlow rely on compiled code and native libraries — such as CUDA for GPUs, BLAS or MKL for linear algebra, and C, C++, and Fortran runtimes — that Python-only tools aren't designed to manage. Conda manages the full stack:

- **Beyond Python** — install native libraries, GPU toolkits, compilers, and packages for other languages such as R, alongside your Python packages. Conda manages the Python version itself, too.
- **Prebuilt binaries** — many packages arrive precompiled for Windows, macOS, and Linux, reducing the need to build from source. Availability varies by platform.
- **Compatible dependencies** — conda's solver resolves package requirements together, though a successful solve doesn't guarantee every workload will run.
- **Isolation** — each conda environment keeps its own packages, so projects can use different versions of Python, PyTorch, or CUDA.
- **Reproducibility** — share an `environment.yml` to recreate an environment's requirements on another machine. It's not an exact cross-platform lockfile; exporting requires a separate conda workflow.

To learn more, see [12 reasons to choose conda](https://www.anaconda.com/blog/12-reasons-to-choose-conda).

## Conda concepts

New to conda? Learn more about fundamental conda concepts in the official Anaconda documentation:

- **[Environment](https://www.anaconda.com/docs/getting-started/concepts/what-is-an-environment)** — an isolated set of packages (and a Python version) for a project.
- **[Package](https://www.anaconda.com/docs/getting-started/concepts/what-is-a-package)** — an installable library or tool.
- **[Channel](https://www.anaconda.com/docs/getting-started/concepts/what-is-a-channel)** — where packages are downloaded from.
- **[environment.yml](https://www.anaconda.com/docs/getting-started/working-with-conda/environments#sharing-an-environment)** — a file that describes an environment so it can be recreated or shared.

## Use a conda environment in your work

Managing a conda environment here doesn't automatically activate it — there's no activate switch in the app. Ask the agent to help configure a project environment for your work.

Notebooks discover supported project environments when they start. An `environment.yml` in the workspace can define one, but other project files may take precedence, and already-running notebooks don't automatically switch. See [Notebooks](/docs/desktop/features/notebooks) for environment setup.

## Working with the agent

The agent can create environments and install, update, or remove packages for you. Managed conda requests ask for approval and name the environment being changed; a clone shows both **Clone from** and **New environment**. They list requested channels, or indicate that configured channels will be used. These tools reject packages from local files and URL or local-path channels; that restriction doesn't cover shell commands. When you're signed in, the agent prefers Anaconda's channels (`defaults` or your organization's channels) and uses `conda-forge` only when a package isn't available there.

The agent can also add or remove conda channels for you, but only named channels (such as `defaults` or `conda-forge`). Because a channel change affects every later install, Kilo Desktop asks you each time: **Allow adding a conda channel?** or **Allow removing a conda channel?**, with the channel listed under **Channels**. Choose **Allow once** or **Reject** — there's no **Always allow** for channel changes. A warning appears when the channel isn't `main`, `defaults`, or `conda-forge`, and when a new channel would take priority over all your existing ones. Approved changes update your user conda settings (`~/.condarc`). If no channels are configured and you haven't named one, the agent asks whether to use Anaconda's `defaults` channel before it continues. It doesn't pick a channel on its own.

## If installs fail

Conda needs at least one channel to install from. An empty selection in the **Channels** control can fall back to your configured channels. If none are configured or supplied, the install fails with *No conda channels are configured, so there is nothing to install from.* Select a channel, ask the agent to use Anaconda's `defaults` channel, or add one to your conda settings.

## Browse your conda environments

The page lists existing conda environments by **name** and **prefix** (the full path on disk). Search by name or path and sort the list. Named environments have an {% svgIcon src="/docs/img/desktop/ellipsis.svg" /%} actions menu for **Clone** or **Delete**. Deleting an environment is irreversible. Select a row to work with its packages.

## Create a conda environment

Click **New environment**, then select **Create new** to open the Create environment dialog.

On the Create environment page, configure your environment:

- **Location** — where the environment is created.
- **Name** — the environment's name.
- **Python version** — choose a specific version to include Python. **Latest** leaves the Python requirement unspecified; it doesn't guarantee Python will be installed.

As you type, Kilo checks that the name and location are available and that you can write there. **Create environment** stays disabled until the check passes. If an environment already exists at that path, or you don't have permission, the dialog tells you.

Search the packages list (**Search packages**) and check the packages to include. Each package has a version dropdown (defaulting to **latest**), and your choices collect in the **Selected packages** panel. Use the {% svgIcon src="/docs/img/desktop/list-filter.svg" /%} **Channels** control to choose where packages come from (see [Choose a channel](#choose-a-channel)). Select **Create environment** to build it.

## Import from a file

Click **New environment**, then select **Import file**. Navigate to or drop a conda environment file (`.yml` or `.yaml`). Review its packages and sources, optionally set a **Name override**, then select **Import**.

## Work with a conda environment's packages

Selecting an environment opens its detail view. The header shows the environment name, its **Python** version, and the full prefix path. Below it, a table lists every installed package with its **Version**, **Source** (conda or pip), and **Channel**. Search by name and sort by any column.

### Update packages

When updates are detected, select **Update *N* packages** to open the Update dialog. Use the checkboxes to choose packages; searching only hides rows and doesn't change your selection. The **Dependency changes** panel previews the update and flags any **Dependency conflict**. Updates can replace or downgrade dependencies and break existing workloads.

Turn on **Back up before updating** to make a separate clone first. It isn't an automatic rollback; if backup fails, you can cancel or choose **Update anyway**.

On a package's row, use the {% svgIcon src="/docs/img/desktop/ellipsis.svg" /%} menu for **Update…** or **Remove**. Update checks exclude pip packages and may not cover every installed conda package. Removing a package can also remove packages that depend on it.

### Add packages

From an open environment, select **Add packages**. Search for a package and pick a version (defaulting to **latest**). Your choices appear in **Selected packages**; transitive changes appear under **Dependency changes**. Use the {% svgIcon src="/docs/img/desktop/list-filter.svg" /%} **Channels** control to choose package sources (see [Choose a channel](#choose-a-channel)).

Review the **Dependency changes** preview for upgrades, downgrades, additions, removals, or rebuilds. Select **Install *N* packages** when available to apply the changes. A long-running install can be sent to **Run in background** so you can keep working.

## Choose a channel

When you select packages, you choose which channels they install from with the {% svgIcon src="/docs/img/desktop/list-filter.svg" /%} **Channels** control:

- **conda-forge** — community-maintained, open-source.
- **Anaconda** (**Main**) — secure, vetted packages hosted by Anaconda.

Eligible custom channels from your conda settings are listed too; recognized Anaconda channels are grouped under **Anaconda**. Offered channels are selected by default. Review your sources before installing packages.

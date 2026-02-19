## Project Overview

This is the Kilo Code documentation site. Kilo Code is the leading open source agentic engineering platform.

## Dev Server

The dev server is run with `bun dev` and runs on `http://localhost:3002`. Typically the user will be running it themselves, so always check if it is running FIRST before deciding to run it yourself to test something.

## Branch Naming Convention

When making changes _only_ to the documentation, create branches with the `docs/` prefix:

```bash
git checkout -b docs/description-of-change
```

This convention helps identify documentation-only PRs and keeps them organized.

## Markdoc Custom Tags

This project uses [Markdoc](https://markdoc.dev/) for rendering markdown with custom components. Custom tags allow you to embed React components directly in markdown files.

### Images

Use the Markdoc image tag format:

```markdown
{% image src="/docs/img/kilo-provider/connected-accounts.png" alt="Connect account screen" width="800" caption="Connect account screen" /%}
```

Note that this site is served under kilo.ai/docs so the `/docs` prefix **must** be present in every image path.

Image attributes:

| Attribute | Type   | Required | Description                                 |
| --------- | ------ | -------- | ------------------------------------------- |
| `src`     | String | Yes      | The image source URL                        |
| `alt`     | String | Yes      | Alternative text for the image              |
| `width`   | String | No       | Width of the image (e.g., '500px', '80%')   |
| `height`  | String | No       | Height of the image (e.g., '300px', 'auto') |
| `caption` | String | No       | Caption displayed below the image           |

### Callouts

Use the Markdoc callout tag format:

```markdown
{% callout type="info" %}
You can report any bugs or feedback by chatting with us in our [Discord server](https://discord.gg/ovhcloud), in the AI Endpoints channel.
{% /callout %}
```

Callout attributes:

| Attribute   | Type    | Default | Description                                       |
| ----------- | ------- | ------- | ------------------------------------------------- |
| `title`     | String  | -       | Optional custom title for the callout             |
| `type`      | String  | "note"  | One of: generic, note, tip, info, warning, danger |
| `collapsed` | Boolean | false   | When true, the callout starts collapsed           |

### Codicons

Use the Markdoc codicon tag format:

```markdown
{% codicon name="gear" /%}
```

## Documentation Guidelines

### Adding New Pages

1. Create your page in the appropriate directory under `pages/`
2. **Always update navigation**: Add the page to the corresponding navigation file in `lib/nav/`
    - Each section has its own nav file (e.g., `getting-started.ts`, `code-with-ai.ts`, `ai-providers.ts`)
    - Navigation structure is exported from `lib/nav/index.ts`
    - See `lib/types.ts` for the `NavSection` and `NavLink` interfaces

### Removing or Moving Pages

**Never remove a page without adding a redirect.** This prevents broken links from search engines, external references, and user bookmarks.

1. Add a redirect entry to `previous-docs-redirects.js`
2. Redirect format:
    ```javascript
    {
      source: "/docs/old-path",
      destination: "/docs/new-path",
      basePath: false,
      permanent: true,
    }
    ```
3. Update the navigation file to remove or update the link
4. Redirects are loaded in `next.config.js`

## Project Overview

This is the Kilo Code documentation site. Kilo Code is the leading open source agentic engineering platform.

## Dev Server

The dev server is run with `bun dev` and runs on `http://localhost:3002`. Typically the user will be running it themselves, so always check if it is running FIRST before deciding to run it yourself to test something.

## Markdoc Custom Tags

This project uses [Markdoc](https://markdoc.dev/) for rendering markdown with custom components. Custom tags allow you to embed React components directly in markdown files.

## Converting from old documentation site

This site was previously in docusaurus but is now in markdoc. Sometimes the user may ask you to update the images and other tags in a page that was imported. These are the types of updates you'd need to make

### Images

Images will often look like standard HTML image tags like:

<img src="/docs/img/kilo-provider/connected-accounts.png" alt="Connect account screen" width="600" />

We want to convert them to Markdoc image tags like this:

{% image src="/docs/img/kilo-provider/connected-accounts.png" alt="Connect account screen" width="800" caption="Connect account screen" /%}

Note that this site is served under kilo.ai/docs so the `/docs` MUST be present in every image tag.

Image attributes

```json
    src: {
      type: String,
      required: true,
      description: "The image source URL",
    },
    alt: {
      type: String,
      required: true,
      description: "Alternative text for the image",
    },
    width: {
      type: String,
      description: "Width of the image (e.g., '500px', '80%')",
    },
    height: {
      type: String,
      description: "Height of the image (e.g., '300px', 'auto')",
    },
    caption: {
      type: String,
      description: "Optional caption displayed below the image",
    }
```

### Callouts

When callouts are used, they should be in markdoc format like this:

```markdown
{% callout type="info" %}
You can report any bugs or feedbacks by chatting with us in our [Discord server](https://discord.gg/ovhcloud), in the AI Endpoints channel.
{% /callout %}
```

Callout Attributes:

```json
    title: {
      type: String,
      description: "Optional custom title for the callout",
    },
    type: {
      type: String,
      default: "note",
      matches: ["generic", "note", "tip", "info", "warning", "danger"],
      description:
        "The type of callout: generic (no icon/title), note, tip, info, warning, or danger",
    },
    collapsed: {
      type: Boolean,
      default: false,
      description:
        "When true, the callout starts collapsed and can be expanded by clicking the header",
    }
```

### Codicons

Codicon icons look like this:

```html
<Codicon name="gear" />
```

And we want to convert that to look like this:

```markdown
{% codicon name="gear" /%}
```

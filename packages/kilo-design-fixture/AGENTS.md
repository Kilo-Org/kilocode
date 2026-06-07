# Design canvas fixture

This is a throwaway static site used as the Browser Canvas for `kilo design`. It
is intentionally tiny so design requests have something concrete to act on.

When asked to make a visual change, edit these files only:

- `public/index.html` — the page markup
- `public/styles.css` — the styling (CSS custom properties live in `:root`)

Guidelines:

- Prefer editing the CSS variables in `:root` (e.g. `--brand`, `--bg`, `--fg`,
  `--radius`, `--space`) when a request is about color, spacing, or shape.
- Keep changes small and focused on what was asked — this is a live, hot-reloading
  canvas, so each edit should be immediately visible.
- Do not add a build step, framework, or dependencies. Plain HTML + CSS only.
- Do not touch `serve.ts` or anything outside `public/` unless explicitly asked.

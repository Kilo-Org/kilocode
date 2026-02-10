/**
 * When true, appends " (NEW)" to user-visible extension labels (command tooltips,
 * sidebar title, tab title, etc.) so users can distinguish this extension from the
 * old one while both are installed side-by-side.
 *
 * Set to false (or remove usages) once the old extension is retired.
 *
 * NOTE: This flag only controls *runtime* labels. The following static values in
 * package.json must also be updated manually when removing this flag:
 * - contributes.commands[*].title — any command title containing "(NEW)"
 * - contributes.viewsContainers.activitybar[0].title
 * - contributes.views.kilo-code-sidebar[0].name
 */
export const NEW_EXTENSION_IS_STILL_EXPERIMENTAL_SO_SHOW_EXTRA_TEXTS_TO_SHOW_DIFFERENCE = true

export const EXTENSION_DISPLAY_NAME =
  "Kilo Code" + (NEW_EXTENSION_IS_STILL_EXPERIMENTAL_SO_SHOW_EXTRA_TEXTS_TO_SHOW_DIFFERENCE ? " (NEW)" : "")

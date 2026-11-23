/**
 * User-facing text for an action on a session that belongs to more than one
 * project, where no project qualifier resolves it.
 *
 * Shared by the provider and the permission and question handlers so every
 * refusal reads the same and never carries the raw session id.
 */
export const SESSION_ROUTE_UNRESOLVED =
  "Kilo could not tell which project this session belongs to. Open the session from its own project and try again."

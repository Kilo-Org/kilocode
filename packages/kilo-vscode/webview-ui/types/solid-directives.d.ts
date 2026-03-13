/**
 * SolidJS custom directive type declarations.
 *
 * SolidJS intentionally ships `JSX.Directives` as an empty interface for
 * consumers to extend via module augmentation. Libraries like
 * `@thisbeyond/solid-dnd` use `use:sortable` but don't ship their own
 * type declarations, so we declare them here.
 *
 * @see https://docs.solidjs.com/concepts/refs#directive-typing
 */

declare module "solid-js" {
	namespace JSX {
		interface Directives {
			sortable: true
		}
	}
}

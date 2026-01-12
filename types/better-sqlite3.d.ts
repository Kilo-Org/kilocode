declare module "better-sqlite3" {
	interface Database {}
	interface Statement {}
	interface Transaction {}

	function BetterSqlite3(filename: string, options?: any): Database

	namespace BetterSqlite3 {}

	export = BetterSqlite3
}

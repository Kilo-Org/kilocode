import { guardedFixtureLayout } from "./fixture"

const layout = guardedFixtureLayout()
console.log(JSON.stringify({ data: layout.paths.data, database: layout.database }))

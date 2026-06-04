interface User {
  id: number
  name: string
  active: boolean
}

function getActiveUserNames(users: User[]): string[] {
  return users
}

const sample: User[] = [
  { id: 1, name: "ada", active: true },
  { id: 2, name: "lin", active: false },
  { id: 3, name: "rin", active: true },
]

console.log(getActiveUserNames(sample))

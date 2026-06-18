function double(x: number): number {
  return x * 2
}

function add(a, b) {
  return a + b
}

function negate(x: number): number {
  return -x
}

function main(): void {
  console.log(double(3))
  console.log(add(2, 4))
  console.log(negate(7))
}

main()

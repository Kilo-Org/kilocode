async function fetchUser(id) {
  try {
  } catch (err) {
    console.error("fetchUser failed", err)
    return null
  }
}

async function main() {
  const user = await fetchUser(42)
  console.log("user:", user)
}

main()

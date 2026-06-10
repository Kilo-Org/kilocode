const app = {
  get: (_path, _handler) => app,
  post: (_path, _handler) => app,
  listen: (_port, cb) => cb && cb(),
}

const users = [
  { id: 1, name: "ada" },
  { id: 2, name: "lin" },
]

app.get("/users/:id", (req, res) => {})

app.post("/users", (req, res) => {
  const user = { id: users.length + 1, name: req.body.name }
  users.push(user)
  res.status(201).json(user)
})

app.listen(3000, () => console.log("listening on :3000"))

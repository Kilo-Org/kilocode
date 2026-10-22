import { AnnotationStore } from "../../src/kilo-provider/annotation-store"

async function run() {
  const storage = process.argv[2]
  const id = process.argv[3]
  if (!storage || !id) throw new Error("Test storage and UUID are required")
  const result = await new AnnotationStore(storage).save({
    id,
    sessionID: "ses_a",
    messageID: "msg_a",
    selectedText: "process fixture",
    comment: "comment",
    createdAt: 1,
    updatedAt: 1,
  })
  console.log(result.items.find((item) => item.id === id)!.number)
}

void run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

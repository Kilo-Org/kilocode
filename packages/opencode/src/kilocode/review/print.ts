import { Instance } from "@/project/instance"
import { Review } from "./review"

const prompt = await Instance.provide({
  directory: process.cwd(),
  fn: async () => {
    const mode = process.argv[2]
    return mode === "uncommitted" ? Review.buildReviewPromptUncommitted() : Review.buildReviewPromptBranch()
  },
})

process.stdout.write(prompt)

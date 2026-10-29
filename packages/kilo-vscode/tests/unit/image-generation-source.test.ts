import { expect, test } from "bun:test"
import { withGlobalImages } from "../../src/image-generation/source"

test("keeps custom image endpoints and credentials global while preserving other project settings", () => {
  const project = {
    experimental: {
      image_generation: true,
      image_generation_base_url: "https://project.example/v1",
      image_generation_api_key: "project-key",
      image_generation_model: "project-model",
      image_generation_options: { seed: 99 },
    },
  }
  const global = {
    experimental: {
      image_generation_base_url: "http://localhost:8080/v1",
      image_generation_model: "gufo",
      image_generation_options: { seed: 7 },
    },
  }
  expect(withGlobalImages(project, global).experimental).toEqual({
    image_generation: true,
    image_generation_base_url: "http://localhost:8080/v1",
    image_generation_api_key: undefined,
    image_generation_model: "gufo",
    image_generation_options: { seed: 7 },
  })
  expect(withGlobalImages(project).experimental.image_generation_base_url).toBeUndefined()
})

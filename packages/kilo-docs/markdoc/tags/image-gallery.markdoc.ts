import { ImageGallery } from "../../components"

export const imageGallery = {
  render: ImageGallery,
  children: ["tag"],
  attributes: {
    columns: {
      type: String,
      description: "Preferred number of image columns on wide screens",
    },
    width: {
      type: String,
      description: "Preferred width of each gallery image",
    },
  },
}

import QRCode from "qrcode"

export async function generateQRCode(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    width: 200,
    margin: 2,
    color: { dark: "#000000", light: "#FFFFFF" },
  })
}

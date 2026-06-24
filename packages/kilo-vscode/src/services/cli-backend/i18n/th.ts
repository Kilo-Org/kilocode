export const dict = {
  "server.processExited": "กระบวนการ CLI ออกด้วยรหัส {{code}} ก่อนที่เซิร์ฟเวอร์จะเริ่มทำงาน",
  "server.startupTimeout": "หมดเวลาการเริ่มต้นเซิร์ฟเวอร์หลังจาก {{seconds}} วินาที",
  "remote.connected": "Kilo Remote: เชื่อมต่อแล้ว",
  "remote.connecting": "Kilo Remote: กำลังเชื่อมต่อ\u2026",
  "kilocode:autocomplete.creditsExhausted.message":
    "Kilo Code Autocomplete ถูกหยุดชั่วคราว สาเหตุที่เป็นไปได้: บัญชี Kilo ของคุณไม่มีเครดิตเหลือ หรือ API key (BYOK) ที่กำหนดค่าไว้ถึงขีดจำกัดโควตาแล้ว โปรดเพิ่มเครดิต Kilo หรือตรวจสอบการกำหนดค่า API key เพื่อใช้งานการเติมโค้ดอัตโนมัติต่อ",
  "kilocode:autocomplete.authError.message":
    "Kilo Code Autocomplete ถูกหยุดชั่วคราวเนื่องจากปัญหาการยืนยันตัวตน สาเหตุที่เป็นไปได้: คุณยังไม่ได้ลงชื่อเข้าใช้ Kilo หรือ API key (BYOK) ไม่ถูกต้องหรือไม่ได้กำหนดไว้ โปรดลงชื่อเข้าใช้อีกครั้งหรือตรวจสอบการตั้งค่า API key ของผู้ให้บริการ",
} as const

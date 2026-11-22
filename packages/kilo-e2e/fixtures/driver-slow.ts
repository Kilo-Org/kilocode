import { driver } from "./driver-lib"

if (import.meta.main) await driver("slow")

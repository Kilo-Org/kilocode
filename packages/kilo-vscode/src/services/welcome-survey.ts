// kilocode_change - new file
/**
 * Welcome survey URL builder
 *
 * Constructs a Typeform URL with hidden fields so survey responses
 * can be linked back to the user without relying solely on PII.
 */

const TYPEFORM_BASE = "https://kilocode.typeform.com/welcome"

/**
 * Build the welcome survey URL with hidden fields.
 *
 * @param options.email      - User email (hidden field)
 * @param options.kiloUserId - Kilo internal user ID (hidden field)
 * @returns Fully-qualified Typeform URL with hidden fields as query params
 */
export function buildWelcomeSurveyUrl(options: { email: string; kiloUserId?: string }): string {
  const url = new URL(TYPEFORM_BASE)
  url.searchParams.set("email", options.email)
  if (options.kiloUserId) {
    url.searchParams.set("kilo_user_id", options.kiloUserId)
  }
  return url.toString()
}

/**
 * The delivery address, taken in parts and stored as one.
 *
 * It used to be a single three-row textarea labelled "Address", which asks a
 * customer on a phone to compose a courier-ready address out of nothing but a
 * placeholder. What came back was whatever they thought of — a house number and
 * nothing else, an area with no district, three lines in an order the next
 * customer would not have used. None of that is recoverable at the door.
 *
 * Parts fix that in three ways at once: each field says what it wants, the
 * required ones cannot be left out, and the browser can fill them — a textarea
 * gets `street-address` and nothing else, whereas these carry the autocomplete
 * tokens a phone actually has saved.
 *
 * Shaped for Bangladesh, which is the only country this shop delivers to
 * (ADR-0003, and the courier groups on the admin board say "across
 * Bangladesh"): house and road, then area or thana, then city or district, then
 * an optional four-digit postcode. Not a country field — there is one — and not
 * a "state", which is not how anybody here writes an address.
 */
export interface AddressParts {
  /** House, flat and road. The line a courier reads last and needs most. */
  line: string
  /** Area or thana — Dhanmondi, Gulshan, Agrabad. */
  area: string
  /** City or district — Dhaka, Chattogram. */
  city: string
  /** Four digits, and genuinely optional: plenty of customers do not know it. */
  postcode: string
}

/** How long each part may be, so one field cannot carry a whole essay. */
export const addressLimits = { line: 200, area: 100, city: 100, postcode: 10 } as const

/** The parts a customer must give. Postcode is not among them. */
const required = [
  ['line', 'house and road'],
  ['area', 'area or thana'],
  ['city', 'city or district'],
] as const

/** Whatever FormData.get hands back, without naming a DOM global this
 *  project's lib config does not carry. */
type FormValue = ReturnType<FormData['get']>

function clean(value: FormValue, max: number): string {
  // Interior whitespace collapsed as well as trimmed: these arrive off a phone
  // keyboard and land on a courier's label, where "Road   12" is a typo the
  // customer cannot see and cannot fix.
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/** The address parts as submitted, trimmed and capped. */
export function readAddressParts(form: FormData): AddressParts {
  return {
    line: clean(form.get('address_line'), addressLimits.line),
    area: clean(form.get('address_area'), addressLimits.area),
    city: clean(form.get('address_city'), addressLimits.city),
    postcode: clean(form.get('address_postcode'), addressLimits.postcode),
  }
}

/**
 * The names of the parts that are missing, in the order they appear on the
 * form — so the message can say what to go back and fill in rather than
 * "Please fill in all required fields", which does not say which.
 */
export function missingAddressParts(parts: AddressParts): string[] {
  return required.filter(([key]) => parts[key] === '').map(([, label]) => label)
}

/**
 * The parts as one address, which is what gets stored and what every screen
 * that shows an order already renders.
 *
 * Deliberately the only stored form. Keeping the parts in their own columns
 * beside this string would be two places for one fact, and the first one to
 * fall out of step with the other — the same argument the schema makes for not
 * storing a variant's label twice. The day the shop wants "every order in
 * Dhaka" as a query, that is a migration with a backfill, not a column added
 * now on the chance that it might be.
 *
 * Three lines, because that is how the address goes on the parcel: street,
 * then area, then city with the postcode after it. Empty parts drop out rather
 * than leaving a blank line for the operator to wonder about.
 */
export function composeAddress(parts: AddressParts): string {
  const cityLine = [parts.city, parts.postcode].filter(Boolean).join(' ')
  return [parts.line, parts.area, cityLine].filter(Boolean).join('\n')
}

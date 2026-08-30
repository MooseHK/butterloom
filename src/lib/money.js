/**
 * Money handling.
 *
 * RULE: every monetary amount in this codebase is an integer number of minor
 * units (cents). Never a float, never a string, never "dollars". Floats break
 * on the third order that ends in .07 and the breakage is silent, so amounts
 * only become decimal at the moment they are rendered for a human.
 *
 * Rates are basis points (bp): 1% = 100bp, 8.25% = 825bp.
 */

/** Throws unless `value` is a safe integer -- catches float leakage early. */
export function assertCents(value, label = 'amount') {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be an integer number of cents, received: ${value}`);
  }
  return value;
}

/** Rounds half away from zero, so 0.5c never silently favours one party. */
function roundHalfUp(value) {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Applies a basis-point rate to an amount, returning whole cents. */
export function applyRateBp(cents, rateBp) {
  assertCents(cents, 'cents');
  if (!Number.isFinite(rateBp)) throw new TypeError(`rateBp must be a number, received: ${rateBp}`);
  return roundHalfUp((cents * rateBp) / 10000);
}

/** Multiplies an amount by a whole-number quantity. */
export function multiply(cents, quantity) {
  assertCents(cents, 'cents');
  assertCents(quantity, 'quantity');
  return cents * quantity;
}

export function sum(amounts) {
  return amounts.reduce((total, amount) => total + assertCents(amount), 0);
}

/**
 * Parses human input ("89", "$89.00", "1,299.50") into cents.
 * Returns null for anything it cannot read exactly -- callers must handle it
 * rather than receiving a plausible-looking wrong number.
 */
export function parseMoney(input) {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? roundHalfUp(input * 100) : null;
  }
  if (typeof input !== 'string') return null;
  const cleaned = input.trim().replace(/[$\s,]/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const negative = cleaned.startsWith('-');
  const [whole, fraction = ''] = cleaned.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return negative ? -cents : cents;
}

const formatterCache = new Map();

function formatter(currency, locale) {
  const key = `${locale}:${currency}`;
  let cached = formatterCache.get(key);
  if (!cached) {
    cached = new Intl.NumberFormat(locale, { style: 'currency', currency });
    formatterCache.set(key, cached);
  }
  return cached;
}

/** Renders cents for display. The only place amounts become decimal. */
export function formatMoney(cents, { currency = 'BDT', locale = 'en-BD' } = {}) {
  assertCents(cents, 'cents');
  return formatter(currency, locale).format(cents / 100);
}

/**
 * Prices a set of cart lines.
 *
 * @param {Array<{unitPriceCents:number, quantity:number}>} lines
 * @param {{taxRateBp?:number, shipping?:{flatCents:number, freeOverCents:number}}} pricing
 * @returns {{subtotalCents:number, shippingCents:number, taxCents:number, totalCents:number, itemCount:number}}
 */
export function priceOrder(lines, pricing = {}) {
  const { taxRateBp = 0, shipping = { flatCents: 0, freeOverCents: Infinity } } = pricing;

  const subtotalCents = sum(lines.map((line) => multiply(line.unitPriceCents, line.quantity)));
  const itemCount = lines.reduce((count, line) => count + assertCents(line.quantity, 'quantity'), 0);

  const freeOver = shipping.freeOverCents;
  const qualifiesForFreeShipping = Number.isFinite(freeOver) ? subtotalCents >= freeOver : false;
  const shippingCents =
    itemCount === 0 || qualifiesForFreeShipping ? 0 : assertCents(shipping.flatCents, 'flatCents');

  // Tax applies to goods, not to shipping, which is the common US default.
  // Jurisdictions that tax shipping need this line changed deliberately.
  const taxCents = applyRateBp(subtotalCents, taxRateBp);

  return {
    subtotalCents,
    shippingCents,
    taxCents,
    totalCents: subtotalCents + shippingCents + taxCents,
    itemCount
  };
}

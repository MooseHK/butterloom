/**
 * Money is integer paisa everywhere (ADR-0006). Formatting is the only place it
 * becomes a decimal, and it happens once, here.
 */
export function formatPaisa(paisa: number): string {
  const taka = Math.trunc(paisa / 100)
  const remainder = Math.abs(paisa % 100)
  const grouped = taka.toLocaleString('en-BD')
  return remainder === 0 ? `৳${grouped}` : `৳${grouped}.${String(remainder).padStart(2, '0')}`
}

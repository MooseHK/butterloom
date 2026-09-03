import { eq, sql } from 'drizzle-orm'
import { config } from '../config.js'
import { db } from '../db/client.js'
import { invoiceSequence, invoices, settings } from '../db/schema.js'
import type { Invoice } from '../db/schema.js'

/**
 * Reads the active VAT rate in basis points (1000 = 10.00%).
 * First checks dynamic admin settings, falls back to config default (10%).
 */
export function getVatRateBp(): number {
  try {
    const [row] = db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, 'vat_rate_bp'))
      .all()
    if (row) {
      const parsed = parseInt(row.value, 10)
      if (Number.isFinite(parsed) && parsed >= 0) return parsed
    }
  } catch (err) {
    console.error('[settings] failed to read vat_rate_bp, using fallback', err)
  }
  return config.defaultVatRateBp
}

/**
 * Updates the active VAT rate in basis points (e.g. 1000 for 10%, 1500 for 15%).
 */
export function setVatRateBp(rateBp: number): void {
  if (!Number.isFinite(rateBp) || rateBp < 0 || rateBp > 10000) {
    throw new Error('VAT rate must be between 0% and 100% (0 to 10000 basis points)')
  }
  const now = Math.floor(Date.now() / 1000)
  db.insert(settings)
    .values({ key: 'vat_rate_bp', value: String(Math.round(rateBp)), updatedAt: sql`${now}` })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: String(Math.round(rateBp)), updatedAt: sql`${now}` },
    })
    .run()
}

/**
 * Calculates the VAT component of a VAT-inclusive price.
 * CRPA s.40 & NBR formula: vat = round(total × rate_bp / (10000 + rate_bp)).
 * Round once at the order level, never per line.
 */
export function calculateVat(
  totalPaisa: number,
  rateBp: number,
): { vatPaisa: number; netPaisa: number } {
  if (totalPaisa <= 0 || rateBp <= 0) {
    return { vatPaisa: 0, netPaisa: Math.max(0, totalPaisa) }
  }
  const vatPaisa = Math.round((totalPaisa * rateBp) / (10000 + rateBp))
  const netPaisa = totalPaisa - vatPaisa
  return { vatPaisa, netPaisa }
}

/**
 * Allocates a gapless monotonic serial number and creates an official Mushak 6.3 invoice.
 * Must be executed inside the same db.transaction() as order placement.
 */
export function allocateInvoice(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  data: {
    orderId: number
    totalPaisa: number
    vatRateBp: number
    vatPaisa: number
    customerName: string
    customerPhone: string
    customerAddress: string
    binNumber?: string | null
  },
): Invoice {
  // Ensure the sequence row exists
  tx.run(sql`INSERT OR IGNORE INTO invoice_sequence (id, last_serial) VALUES (1, 0)`)

  // Monotonically increment sequence
  const rows = tx.all<{ last_serial: number }>(
    sql`UPDATE invoice_sequence SET last_serial = last_serial + 1 WHERE id = 1 RETURNING last_serial`,
  )
  const serial = rows[0]?.last_serial
  if (!serial) {
    throw new Error('Failed to allocate gapless invoice serial number')
  }

  const mushakNumber = `BL-6.3-${String(serial).padStart(6, '0')}`
  const netPaisa = data.totalPaisa - data.vatPaisa

  const [invoice] = tx
    .insert(invoices)
    .values({
      orderId: data.orderId,
      serialNumber: serial,
      mushakNumber,
      totalPaisa: data.totalPaisa,
      vatRateBp: data.vatRateBp,
      vatPaisa: data.vatPaisa,
      netPaisa,
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      customerAddress: data.customerAddress,
      binNumber: data.binNumber ?? config.bin,
    })
    .returning()
    .all()

  if (!invoice) {
    throw new Error('Failed to create invoice record')
  }

  return invoice
}

export function findInvoiceByOrderId(orderId: number): Invoice | null {
  const [row] = db.select().from(invoices).where(eq(invoices.orderId, orderId)).all()
  return row ?? null
}

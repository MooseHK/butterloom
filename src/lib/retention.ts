import { desc } from 'drizzle-orm'
import { db } from '../db/client.js'
import { invoices, orderEvents, orderItems, orders } from '../db/schema.js'

/**
 * DCOG 2021 & VAT Act 6-year statutory record retention.
 * Gathers business-record tables: orders, items, state events, and Mushak 6.3 invoices.
 */
export function exportRetentionData(): {
  exportedAt: string
  records: {
    orders: unknown[]
    orderItems: unknown[]
    orderEvents: unknown[]
    invoices: unknown[]
  }
} {
  const allOrders = db.select().from(orders).orderBy(desc(orders.id)).all()
  const allItems = db.select().from(orderItems).orderBy(desc(orderItems.id)).all()
  const allEvents = db.select().from(orderEvents).orderBy(desc(orderEvents.id)).all()
  const allInvoices = db.select().from(invoices).orderBy(desc(invoices.id)).all()

  return {
    exportedAt: new Date().toISOString(),
    records: {
      orders: allOrders,
      orderItems: allItems,
      orderEvents: allEvents,
      invoices: allInvoices,
    },
  }
}

import { asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { raw } from 'hono/html'
import { config } from '../config.js'
import { db } from '../db/client.js'
import { orderItems, orders } from '../db/schema.js'
import { formatPaisa } from '../lib/money.js'
import { formatFulfilmentState, formatOrderId, parseOrderId } from '../lib/order.js'
import { findInvoiceByOrderId } from '../lib/settings.js'
import { StorefrontLayout } from '../views/storefront.js'

export const orderRoutes = new Hono()

orderRoutes.get('/:id', (c) => {
  c.header('Cache-Control', 'no-store')
  const rawId = c.req.param('id')
  const orderId = parseOrderId(rawId)
  if (!orderId) return c.notFound()

  const [order] = db.select().from(orders).where(eq(orders.id, orderId)).all()
  if (!order) return c.notFound()

  const items = db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id))
    .orderBy(asc(orderItems.id))
    .all()

  const formattedId = formatOrderId(order.id)

  return c.html(
    <StorefrontLayout
      title={`Order ${formattedId} Confirmed — butterloom`}
      canonicalPath={`/order/${rawId}`}
    >
      <main>
        <div class="confirm">
          <div class="confirm-badge" aria-hidden="true">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
          <h1>Thank you for your order</h1>
          <p class="muted">Reference {formattedId}</p>
        </div>

        <div class="panel">
          <h2 class="panel-head">Where it is going</h2>
          <p>{order.customerName}</p>
          <p class="muted">{order.customerPhone}</p>
          <p class="address">{order.deliveryAddress}</p>
          {order.deliveryNotes ? <p class="muted note">{order.deliveryNotes}</p> : null}
        </div>

        <div class="panel">
          <h2 class="panel-head">What you ordered</h2>
          <div class="lines">
            {items.map((item) => (
              <div class="line">
                <span>
                  {item.productTitle}
                  {item.variantLabel ? ` — ${item.variantLabel}` : ''}
                  <span class="qty"> × {item.quantity}</span>
                </span>
                <span class="amount">{formatPaisa(item.pricePaisa * item.quantity)}</span>
              </div>
            ))}
          </div>
          <div class="cart-row" style="margin-top: 12px; font-size: 13.5px;">
            <span class="lab">Net amount</span>
            <span>{formatPaisa(order.totalPaisa - order.vatPaisa)}</span>
          </div>
          <div class="cart-row" style="font-size: 13.5px;">
            <span class="lab">VAT ({(order.vatRateBp / 100).toFixed(1)}% included)</span>
            <span>{formatPaisa(order.vatPaisa)}</span>
          </div>
          <div class="cart-row grand">
            <span>To pay on delivery</span>
            <span>{formatPaisa(order.totalPaisa)}</span>
          </div>
        </div>

        {/* Fulfilment State is our word (CONTEXT.md); the customer is being
            told where their parcel is, which is the same fact in their
            language. */}
        <div class="panel">
          <h2 class="panel-head">Where it has got to</h2>
          <div class="cart-row">
            <span class="lab">Status</span>
            <span>{formatFulfilmentState(order.fulfilmentState)}</span>
          </div>
          {/* Only while it is true. A confirmation page is bookmarked and
              revisited, and a parcel already delivered should not still be
              claiming it is being packed. */}
          {order.fulfilmentState === 'placed' ? (
            <p class="muted note">
              We are packing it now. It goes out on the next morning's courier run.
            </p>
          ) : null}
        </div>

        <div class="actions" style="display: flex; flex-direction: column; gap: 10px;">
          <a href={`/order/${rawId}/invoice`} target="_blank" class="btn" rel="noopener">
            View / Print Mushak 6.3 Tax Invoice
          </a>
          <a href="/" class="btn secondary">
            Keep looking
          </a>
        </div>
      </main>
    </StorefrontLayout>,
  )
})

orderRoutes.get('/:id/invoice', (c) => {
  c.header('Cache-Control', 'no-store')
  const rawId = c.req.param('id')
  const orderId = parseOrderId(rawId)
  if (!orderId) return c.notFound()

  const [order] = db.select().from(orders).where(eq(orders.id, orderId)).all()
  if (!order) return c.notFound()

  const items = db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id))
    .orderBy(asc(orderItems.id))
    .all()

  const invoice = findInvoiceByOrderId(order.id)
  const mushakNo = invoice ? invoice.mushakNumber : `BL-6.3-${String(order.id).padStart(6, '0')}`
  const issuedDate = new Date((invoice ? invoice.issuedAt : order.createdAt) * 1000).toLocaleString(
    'en-GB',
    { timeZone: 'Asia/Dhaka' },
  )

  const vatPercent = (order.vatRateBp / 100).toFixed(1)
  const netPaisa = order.totalPaisa - order.vatPaisa

  return c.html(
    <>
      {raw('<!doctype html>')}
      <html lang="bn">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>কর চালানপত্র (মূসক-৬.৩) — {mushakNo}</title>
          <style
            dangerouslySetInnerHTML={{
              __html: `
            body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 20px; color: #1a1a1a; background: #fff; line-height: 1.4; font-size: 13px; }
            .invoice-box { max-width: 800px; margin: 0 auto; border: 1px solid #ddd; padding: 24px; }
            .nbr-head { text-align: center; margin-bottom: 20px; }
            .nbr-head h2 { margin: 0 0 4px; font-size: 16px; font-weight: 600; }
            .nbr-head h1 { margin: 0 0 4px; font-size: 18px; font-weight: bold; }
            .nbr-head p { margin: 0; font-size: 12px; color: #555; }
            .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 20px 0; font-size: 13px; }
            .meta-grid div { display: flex; flex-direction: column; gap: 4px; }
            table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 12.5px; }
            th, td { border: 1px solid #333; padding: 6px 8px; text-align: left; }
            th { background: #f2f2f2; text-align: center; }
            td.num { text-align: right; }
            td.centre { text-align: center; }
            .totals { margin-top: 10px; width: 50%; margin-left: auto; }
            .totals table th { text-align: left; background: none; }
            .footer-notes { margin-top: 30px; font-size: 11.5px; color: #555; }
            .no-print { margin-bottom: 20px; display: flex; gap: 10px; }
            .btn-print { padding: 8px 16px; background: #1a1a1a; color: #fff; border: none; border-radius: 2px; cursor: pointer; font-size: 14px; }
            @media print {
              body { padding: 0; }
              .invoice-box { border: none; padding: 0; }
              .no-print { display: none !important; }
            }
          `,
            }}
          />
        </head>
        <body>
          <div class="no-print" style="max-width: 800px; margin: 0 auto 16px;">
            <button class="btn-print" onclick="window.print()">Print Invoice</button>
            <a href={`/order/${rawId}`} style="display: inline-flex; align-items: center; text-decoration: none; color: #1a1a1a;">
              ← Back to order
            </a>
          </div>
          <div class="invoice-box">
            <div class="nbr-head">
              <h2>গণপ্রজাতন্ত্রী বাংলাদেশ সরকার</h2>
              <p>জাতীয় রাজস্ব বোর্ড</p>
              <h1>কর চালানপত্র (মূসক-৬.৩)</h1>
              <p>[বিধি ৪০ এর উপ-বিধি (১) এর দফা (গ) ও দফা (চ) দ্রষ্টব্য]</p>
            </div>

            <div class="meta-grid">
              <div>
                <b>নিবন্ধিত ব্যক্তির নাম:</b> বাটারলুম (Butterloom)
                <span><b>বিআইএন (BIN):</b> {config.bin}</span>
                <span><b>চালানপত্র নম্বর:</b> {mushakNo}</span>
                <span><b>ইস্যুর তারিখ ও সময়:</b> {issuedDate}</span>
                <span><b>পণ্য প্রেরণের স্থান:</b> ঢাকা, বাংলাদেশ</span>
              </div>
              <div>
                <b>ক্রেতার নাম:</b> {order.customerName}
                <span><b>ক্রেতার ফোন:</b> {order.customerPhone}</span>
                <span><b>ক্রেতার ঠিকানা:</b> {order.deliveryAddress}</span>
                <span><b>অর্ডার রেফারেন্স:</b> {formatOrderId(order.id)}</span>
                <span><b>পেমেন্ট মাধ্যম:</b> ক্যাশ অন ডেলিভারি (COD)</span>
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th style="width: 35px;">ক্রমিক</th>
                  <th>পণ্যের বিবরণ</th>
                  <th style="width: 45px;">পরিমাণ</th>
                  <th style="width: 80px;">একক মূল্য (৳)</th>
                  <th style="width: 90px;">মোট মূল্য (৳)</th>
                  <th style="width: 60px;">মূসক হার</th>
                  <th style="width: 80px;">মূসকের পরিমাণ (৳)</th>
                  <th style="width: 90px;">সর্বমোট মূল্য (৳)</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const lineTotalPaisa = item.pricePaisa * item.quantity
                  const lineVatPaisa = Math.round((lineTotalPaisa * order.vatRateBp) / (10000 + order.vatRateBp))
                  const lineNetPaisa = lineTotalPaisa - lineVatPaisa
                  return (
                    <tr>
                      <td class="centre">{idx + 1}</td>
                      <td>
                        {item.productTitle}
                        {item.variantLabel ? ` (${item.variantLabel})` : ''}
                      </td>
                      <td class="centre">{item.quantity}</td>
                      <td class="num">{(item.pricePaisa / 100).toFixed(2)}</td>
                      <td class="num">{(lineNetPaisa / 100).toFixed(2)}</td>
                      <td class="centre">{vatPercent}%</td>
                      <td class="num">{(lineVatPaisa / 100).toFixed(2)}</td>
                      <td class="num">{(lineTotalPaisa / 100).toFixed(2)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            <div class="totals">
              <table>
                <tr>
                  <th>মোট করযোগ্য মূল্য (Net):</th>
                  <td class="num">{formatPaisa(netPaisa)}</td>
                </tr>
                <tr>
                  <th>মোট মূসক ({vatPercent}% VAT):</th>
                  <td class="num">{formatPaisa(order.vatPaisa)}</td>
                </tr>
                <tr>
                  <th>সর্বমোট প্রদেয় মূল্য (Gross Total):</th>
                  <td class="num"><b>{formatPaisa(order.totalPaisa)}</b></td>
                </tr>
              </table>
            </div>

            <div class="footer-notes">
              <p>
                * এটি ডিজিটালভাবে প্রস্তুতকৃত মূসক-৬.৩ চালানপত্র। মূল্য সংযোজন কর ও সম্পূরক শুল্ক আইন, ২০১২ অনুযায়ী এতে কোনো স্বাক্ষরের প্রয়োজন নেই।
              </p>
              <p>
                বাটারলুম (Butterloom) · ট্রেড লাইসেন্স: {config.tradeLicence} · টিআইএন: {config.tin} · ডিবিআইডি: {config.dbid}
              </p>
            </div>
          </div>
        </body>
      </html>
    </>,
  )
})


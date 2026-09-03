import { Hono } from 'hono'
import { config } from '../config.js'
import { exportRetentionData } from '../lib/retention.js'
import { getVatRateBp, setVatRateBp } from '../lib/settings.js'
import { AdminLayout } from '../views/layout.js'

export const adminSettings = new Hono()

adminSettings.get('/', (c) => {
  const currentRateBp = getVatRateBp()
  const currentPercent = (currentRateBp / 100).toFixed(2).replace(/\.00$/, '')
  const notice = c.req.query('notice')
  const error = c.req.query('error')

  return c.html(
    <AdminLayout title="Store Settings & Compliance" section="settings">
      <div class="settings-wrap" style="max-width: 600px; display: flex; flex-direction: column; gap: 24px;">
        {notice ? <p class="notice">{notice}</p> : null}
        {error ? <p class="notice error">{error}</p> : null}

        <section class="settings-card" style="padding: 20px; border: 1px solid var(--hairline, #e2ddd1); border-radius: 2px;">
          <h2 style="margin: 0 0 8px; font-size: 18px;">VAT & Tax Configuration</h2>
          <p class="muted" style="margin: 0 0 16px; font-size: 13.5px;">
            DCOG 2021 & VAT Act mandate displaying VAT-inclusive prices while itemising the VAT component
            on official receipts and Mushak 6.3 invoices. Default is 10.00%.
          </p>

          <form method="post" action="/admin/settings/vat" style="display: flex; flex-direction: column; gap: 14px;">
            <label style="display: flex; flex-direction: column; gap: 6px; font-size: 14px;">
              <span>Active VAT Rate (%)</span>
              <div style="display: flex; align-items: center; gap: 8px;">
                <input
                  type="number"
                  name="vat_percent"
                  step="0.01"
                  min="0"
                  max="100"
                  value={currentPercent}
                  required
                  style="width: 120px; padding: 8px 12px; font-size: 15px; border: 1px solid #ccc; border-radius: 2px;"
                />
                <span style="font-weight: 500;">%</span>
                <span class="muted" style="font-size: 13px;">({currentRateBp} basis points)</span>
              </div>
            </label>
            <button type="submit" class="btn" style="width: auto; align-self: flex-start; padding: 8px 16px; min-height: 40px;">
              Update VAT Rate
            </button>
          </form>
        </section>

        <section class="settings-card" style="padding: 20px; border: 1px solid var(--hairline, #e2ddd1); border-radius: 2px;">
          <h2 style="margin: 0 0 8px; font-size: 18px;">Statutory Business Identifiers</h2>
          <p class="muted" style="margin: 0 0 16px; font-size: 13.5px;">
            Displayed across the public storefront footer and official Mushak 6.3 invoices (DCOG 2021).
          </p>

          <dl style="display: grid; grid-template-columns: 140px 1fr; gap: 10px 16px; margin: 0; font-size: 14px;">
            <dt style="color: #666;">DBID / UBI:</dt>
            <dd style="margin: 0; font-family: monospace;">{config.dbid}</dd>

            <dt style="color: #666;">Trade Licence:</dt>
            <dd style="margin: 0; font-family: monospace;">{config.tradeLicence}</dd>

            <dt style="color: #666;">BIN (13-digit):</dt>
            <dd style="margin: 0; font-family: monospace;">{config.bin}</dd>

            <dt style="color: #666;">TIN (12-digit):</dt>
            <dd style="margin: 0; font-family: monospace;">{config.tin}</dd>

            <dt style="color: #666;">Compliance Officer:</dt>
            <dd style="margin: 0;">{config.complianceOfficerName} ({config.complianceOfficerPhone} · {config.complianceOfficerEmail})</dd>
          </dl>
        </section>

        <section class="settings-card" style="padding: 20px; border: 1px solid var(--hairline, #e2ddd1); border-radius: 2px;">
          <h2 style="margin: 0 0 8px; font-size: 18px;">6-Year Statutory Archival</h2>
          <p class="muted" style="margin: 0 0 16px; font-size: 13.5px;">
            DCOG 2021 & VAT Act mandate maintaining transactions, customer data, state audit events,
            and invoice records for six years.
          </p>
          <a
            href="/admin/settings/retention-export"
            class="btn secondary"
            style="display: inline-flex; width: auto; padding: 8px 16px; min-height: 40px;"
            download="butterloom-retention-archive.json"
          >
            Export Business Records (JSON)
          </a>
        </section>
      </div>
    </AdminLayout>,
  )
})

adminSettings.post('/vat', async (c) => {
  const form = await c.req.formData().catch(() => null)
  const rawPercent = String(form?.get('vat_percent') ?? '').trim()
  const percent = parseFloat(rawPercent)

  if (isNaN(percent) || percent < 0 || percent > 100) {
    return c.redirect(
      '/admin/settings?error=' + encodeURIComponent('VAT rate must be a valid percentage between 0 and 100.'),
      303,
    )
  }

  const rateBp = Math.round(percent * 100)
  try {
    setVatRateBp(rateBp)
    return c.redirect(
      `/admin/settings?notice=${encodeURIComponent(`VAT rate updated to ${percent}% (${rateBp} basis points).`)}`,
      303,
    )
  } catch (err: any) {
    return c.redirect('/admin/settings?error=' + encodeURIComponent(err?.message || 'Failed to update VAT rate'), 303)
  }
})

adminSettings.get('/retention-export', (c) => {
  const data = exportRetentionData()
  c.header('Content-Type', 'application/json')
  c.header('Content-Disposition', 'attachment; filename="butterloom-retention-archive.json"')
  return c.text(JSON.stringify(data, null, 2))
})

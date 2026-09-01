import { randomBytes } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import type { Context } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { db } from '../db/client.js'
import { cartItems, sessions } from '../db/schema.js'
import type { Session } from '../db/schema.js'

export const SESSION_COOKIE_NAME = 'bl_session'

/**
 * Look up the current visitor's session without creating one or setting a cookie.
 * Safe for use on edge-cacheable GET routes.
 */
export function getSession(c: Context): Session | null {
  const token = getCookie(c, SESSION_COOKIE_NAME)
  if (!token) return null
  const [session] = db.select().from(sessions).where(eq(sessions.token, token)).all()
  return session ?? null
}

/**
 * Get the current visitor's session, or create one and set the session cookie.
 * Used on mutating or non-cached endpoints (e.g. /cart/add, /cart, /checkout).
 */
export function getOrCreateSession(c: Context): Session {
  const existing = getSession(c)
  if (existing) {
    // Refresh last_seen_at
    db.update(sessions)
      .set({ lastSeenAt: sql`(unixepoch())` })
      .where(eq(sessions.id, existing.id))
      .run()
    return existing
  }

  const token = randomBytes(16).toString('hex')
  const [session] = db
    .insert(sessions)
    .values({ token })
    .returning()
    .all()

  if (!session) {
    throw new Error('Failed to create session')
  }

  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  })

  return session
}

/**
 * The number in the header badge, and nothing else.
 *
 * `/` and `/p/:slug` are edge-cached (ADR-0007), so their HTML has to be byte
 * identical for every visitor — a server-rendered count would hand one
 * shopper's cart to the next one served from the Dhaka PoP. The count therefore
 * rides a cookie the cacheable pages never set and only read from script, which
 * leaves the cached bytes constant and still lets the badge survive a
 * navigation. Deliberately readable by script, unlike the session cookie: it
 * holds a small integer, and being read in the browser is its entire job.
 *
 * Every route that changes what is in a cart calls this, so the badge and the
 * cart cannot disagree.
 */
export function syncCartCountCookie(c: Context, session?: Session | null): void {
  const count = session === null ? 0 : getCartItemCount(c, session ?? undefined)
  setCookie(c, CART_COUNT_COOKIE_NAME, String(count), {
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
}

export const CART_COUNT_COOKIE_NAME = 'bl_cart_count'

/**
 * Return total quantity of items currently in visitor's cart.
 */
export function getCartItemCount(c: Context, explicitSession?: Session): number {
  const session = explicitSession ?? getSession(c)
  if (!session) return 0

  const [result] = db
    .select({ total: sql<number>`coalesce(sum(${cartItems.quantity}), 0)` })
    .from(cartItems)
    .where(eq(cartItems.sessionId, session.id))
    .all()

  return Number(result?.total ?? 0)
}


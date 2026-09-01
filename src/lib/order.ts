import type { FulfilmentState } from '../db/schema.js'

/**
 * Format sequential numeric order ID into BL-XXXX representation.
 */
export function formatOrderId(id: number): string {
  return `BL-${String(id).padStart(4, '0')}`
}

/**
 * Parse an order ID string (e.g. "BL-0042" or "42") into its numeric ID.
 */
export function parseOrderId(input: string): number | null {
  const trimmed = input.trim()
  const match = /^BL-(\d+)$/i.exec(trimmed)
  if (match && match[1]) {
    const num = Number(match[1])
    return Number.isSafeInteger(num) && num > 0 ? num : null
  }
  const direct = Number(trimmed)
  if (Number.isSafeInteger(direct) && direct > 0) return direct
  return null
}

const validTransitions: Record<FulfilmentState, readonly FulfilmentState[]> = {
  placed: ['packed', 'cancelled'],
  packed: ['handed_over', 'cancelled'],
  handed_over: ['delivered', 'returned'],
  delivered: [],
  returned: [],
  cancelled: [],
}

/**
 * Verify whether transitioning an order from `fromState` to `toState` is allowed.
 */
export function isValidStateTransition(fromState: FulfilmentState, toState: FulfilmentState): boolean {
  const allowed = validTransitions[fromState]
  return allowed ? allowed.includes(toState) : false
}

/**
 * Return the next linear progression state in the fulfilment lifecycle.
 */
export function getNextFulfilmentState(currentState: FulfilmentState): FulfilmentState | null {
  switch (currentState) {
    case 'placed':
      return 'packed'
    case 'packed':
      return 'handed_over'
    case 'handed_over':
      return 'delivered'
    default:
      return null
  }
}

/**
 * Human-readable label for advancing state in admin UI.
 */
export function getAdvanceActionLabel(currentState: FulfilmentState): string | null {
  switch (currentState) {
    case 'placed':
      return 'Mark packed'
    case 'packed':
      return 'Hand to courier'
    case 'handed_over':
      return 'Mark delivered'
    default:
      return null
  }
}

/**
 * Display label for fulfilment state.
 */
export function formatFulfilmentState(state: FulfilmentState): string {
  switch (state) {
    case 'placed':
      return 'Placed'
    case 'packed':
      return 'Packed'
    case 'handed_over':
      return 'Handed over'
    case 'delivered':
      return 'Delivered'
    case 'returned':
      return 'Returned (RTO)'
    case 'cancelled':
      return 'Cancelled'
    default:
      return state
  }
}

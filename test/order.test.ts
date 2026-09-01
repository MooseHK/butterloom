import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  formatFulfilmentState,
  formatOrderId,
  getAdvanceActionLabel,
  getNextFulfilmentState,
  isValidStateTransition,
  parseOrderId,
} from '../src/lib/order.js'

test('formatOrderId formats sequential IDs with zero padding', () => {
  assert.equal(formatOrderId(1), 'BL-0001')
  assert.equal(formatOrderId(42), 'BL-0042')
  assert.equal(formatOrderId(999), 'BL-0999')
  assert.equal(formatOrderId(1000), 'BL-1000')
  assert.equal(formatOrderId(12345), 'BL-12345')
})

test('parseOrderId parses BL-XXXX and raw numeric strings', () => {
  assert.equal(parseOrderId('BL-0001'), 1)
  assert.equal(parseOrderId('bl-0042'), 42)
  assert.equal(parseOrderId('BL-1000'), 1000)
  assert.equal(parseOrderId('42'), 42)
  assert.equal(parseOrderId('  BL-0050  '), 50)
  assert.equal(parseOrderId('invalid'), null)
  assert.equal(parseOrderId('BL-abc'), null)
  assert.equal(parseOrderId('-1'), null)
})

test('state transitions enforce forward-only rules', () => {
  // Forward transitions
  assert.ok(isValidStateTransition('placed', 'packed'))
  assert.ok(isValidStateTransition('packed', 'handed_over'))
  assert.ok(isValidStateTransition('handed_over', 'delivered'))

  // Cancellations
  assert.ok(isValidStateTransition('placed', 'cancelled'))
  assert.ok(isValidStateTransition('packed', 'cancelled'))

  // Returns (RTO)
  assert.ok(isValidStateTransition('handed_over', 'returned'))

  // Disallowed forward jumps
  assert.ok(!isValidStateTransition('placed', 'handed_over'))
  assert.ok(!isValidStateTransition('placed', 'delivered'))
  assert.ok(!isValidStateTransition('placed', 'returned'))
  assert.ok(!isValidStateTransition('packed', 'delivered'))
  assert.ok(!isValidStateTransition('packed', 'returned'))

  // Disallowed backwards transitions
  assert.ok(!isValidStateTransition('packed', 'placed'))
  assert.ok(!isValidStateTransition('handed_over', 'packed'))
  assert.ok(!isValidStateTransition('handed_over', 'placed'))
  assert.ok(!isValidStateTransition('delivered', 'handed_over'))

  // Terminal states cannot transition
  assert.ok(!isValidStateTransition('delivered', 'placed'))
  assert.ok(!isValidStateTransition('delivered', 'cancelled'))
  assert.ok(!isValidStateTransition('returned', 'placed'))
  assert.ok(!isValidStateTransition('returned', 'delivered'))
  assert.ok(!isValidStateTransition('cancelled', 'placed'))
  assert.ok(!isValidStateTransition('cancelled', 'delivered'))
})

test('getNextFulfilmentState and getAdvanceActionLabel match lifecycle', () => {
  assert.equal(getNextFulfilmentState('placed'), 'packed')
  assert.equal(getAdvanceActionLabel('placed'), 'Mark packed')

  assert.equal(getNextFulfilmentState('packed'), 'handed_over')
  assert.equal(getAdvanceActionLabel('packed'), 'Hand to courier')

  assert.equal(getNextFulfilmentState('handed_over'), 'delivered')
  assert.equal(getAdvanceActionLabel('handed_over'), 'Mark delivered')

  assert.equal(getNextFulfilmentState('delivered'), null)
  assert.equal(getAdvanceActionLabel('delivered'), null)

  assert.equal(getNextFulfilmentState('returned'), null)
  assert.equal(getNextFulfilmentState('cancelled'), null)
})

test('formatFulfilmentState returns human readable labels', () => {
  assert.equal(formatFulfilmentState('placed'), 'Placed')
  assert.equal(formatFulfilmentState('packed'), 'Packed')
  assert.equal(formatFulfilmentState('handed_over'), 'Handed over')
  assert.equal(formatFulfilmentState('delivered'), 'Delivered')
  assert.equal(formatFulfilmentState('returned'), 'Returned (RTO)')
  assert.equal(formatFulfilmentState('cancelled'), 'Cancelled')
})

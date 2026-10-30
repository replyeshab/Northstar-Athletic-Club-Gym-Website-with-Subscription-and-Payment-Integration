import test from 'node:test';
import assert from 'node:assert/strict';
import { reserveClassSpot, materializeBooking, releaseClassSpot, repairSessionReservations } from './lib/bookings.js';
import { buildOrderMembershipActivation, paymentRecordFilter, paymentStatusCanUpdate } from './lib/payments.js';
import { webhookDeliveryDecision } from './lib/webhooks.js';

const now = new Date('2026-10-25T10:00:00.000Z');

class MemoryQuery {
  constructor(value) { this.value = value; }
  select() { return this; }
  lean() { return Promise.resolve(this.value); }
  then(resolve, reject) { return Promise.resolve(this.value).then(resolve, reject); }
}

class MemorySession {
  static row;
  static reset({ capacity = 1 } = {}) {
    this.row = { _id: 'session-1', published: true, date: new Date(now.getTime() + 86400000), capacity, seatsBooked: 0, reservedUserIds: [] };
  }
  static async findOneAndUpdate(filter, update) {
    const row = this.row;
    const userId = filter.reservedUserIds.$ne;
    if (String(row._id) !== String(filter._id) || !row.published || row.date <= filter.date.$gt) return null;
    if (row.reservedUserIds.some((id) => String(id) === String(userId)) || row.seatsBooked >= row.capacity) return null;
    row.reservedUserIds.push(userId);
    row.seatsBooked += update.$inc.seatsBooked;
    return { ...row, reservedUserIds: [...row.reservedUserIds] };
  }
  static async findOne(filter) {
    return String(this.row._id) === String(filter._id) && this.row.reservedUserIds.some((id) => String(id) === String(filter.reservedUserIds))
      ? { ...this.row }
      : null;
  }
  static find(filter) {
    return new MemoryQuery(filter.reservedUserIds ? (this.row.reservedUserIds.length ? [{ ...this.row, reservedUserIds: [...this.row.reservedUserIds] }] : []) : []);
  }
  static async updateOne(filter) {
    if (String(this.row._id) !== String(filter._id)) return { modifiedCount: 0 };
    const userId = filter.reservedUserIds;
    const index = this.row.reservedUserIds.findIndex((id) => String(id) === String(userId));
    if (index < 0) return { modifiedCount: 0 };
    this.row.reservedUserIds.splice(index, 1);
    this.row.seatsBooked = Math.max(0, this.row.seatsBooked - 1);
    return { modifiedCount: 1 };
  }
}

class MemoryBooking {
  static rows;
  static nextId;
  static reset() { this.rows = new Map(); this.nextId = 1; }
  static key(sessionId, userId) { return String(sessionId) + ':' + String(userId); }
  static async findOneAndUpdate(filter) {
    const key = this.key(filter.session, filter.user);
    const existing = this.rows.get(key);
    if (existing?.cancelRequestedAt) {
      const error = new Error('duplicate key');
      error.code = 11000;
      throw error;
    }
    const row = existing || { _id: 'booking-' + this.nextId++, session: filter.session, user: filter.user };
    row.status = 'booked';
    this.rows.set(key, row);
    return row;
  }
  static async findOne(filter) { return this.rows.get(this.key(filter.session, filter.user)) || null; }
  static find(filter) {
    const rows = [...this.rows.values()].filter((row) => filter.cancelRequestedAt ? Boolean(row.cancelRequestedAt) : true);
    return new MemoryQuery(rows);
  }
}

function applyOrderActivation(member, paymentId, paidAt, interval) {
  const update = buildOrderMembershipActivation(member._id, paymentId, paidAt, interval);
  if (update.filter._id !== member._id || member.activatedOrderPaymentIds.includes(paymentId)) return false;
  if (member.razorpayCapturedPaymentId && member.razorpayCapturedPaymentId !== paymentId) return false;
  const set = update.update[0].$set;
  const current = member.currentPeriodEnd ? new Date(member.currentPeriodEnd) : new Date(paidAt);
  const start = current > paidAt ? current : new Date(paidAt);
  const next = new Date(start);
  if (set.currentPeriodEnd.$dateAdd.unit === 'year') next.setFullYear(next.getFullYear() + 1);
  else if (set.currentPeriodEnd.$dateAdd.unit === 'week') next.setDate(next.getDate() + 7);
  else if (set.currentPeriodEnd.$dateAdd.unit === 'day') next.setDate(next.getDate() + 1);
  else next.setMonth(next.getMonth() + 1);
  member.currentPeriodEnd = next;
  member.status = 'active';
  member.razorpayCapturedPaymentId = paymentId;
  member.activatedOrderPaymentIds.push(paymentId);
  return true;
}

test('only one member reserves the final class spot during a race', async () => {
  MemorySession.reset({ capacity: 1 });
  const results = await Promise.all([
    reserveClassSpot('session-1', 'member-a', now, MemorySession),
    reserveClassSpot('session-1', 'member-b', now, MemorySession),
  ]);
  assert.equal(results.filter((result) => result.reserved && !result.alreadyReserved).length, 1);
  assert.equal(MemorySession.row.seatsBooked, 1);
  assert.equal(MemorySession.row.reservedUserIds.length, 1);
});

test('a persisted seat reservation repairs the booking after a simulated process crash', async () => {
  MemorySession.reset({ capacity: 1 });
  MemoryBooking.reset();
  await reserveClassSpot('session-1', 'member-a', now, MemorySession);
  assert.equal(MemoryBooking.rows.size, 0);
  await repairSessionReservations({ SessionModel: MemorySession, BookingModel: MemoryBooking, notifyFn: async () => {} });
  assert.equal(MemoryBooking.rows.size, 1);
  assert.equal(MemorySession.row.seatsBooked, 1);
});

test('a payment retry after membership activation does not extend the period twice', () => {
  const paidAt = new Date('2026-10-25T10:00:00.000Z');
  const member = { _id: 'member-1', currentPeriodEnd: null, activatedOrderPaymentIds: [], status: 'incomplete' };
  assert.equal(applyOrderActivation(member, 'pay-1', paidAt, 'month'), true);
  const firstEnd = member.currentPeriodEnd.getTime();
  // Simulate a crash before the payment row was written, followed by webhook retry.
  assert.equal(applyOrderActivation(member, 'pay-1', paidAt, 'month'), false);
  assert.equal(member.currentPeriodEnd.getTime(), firstEnd);
});

test('a second captured payment for the same order does not grant a second membership period', () => {
  const paidAt = new Date('2026-10-25T10:00:00.000Z');
  const member = { _id: 'member-1', currentPeriodEnd: null, activatedOrderPaymentIds: [], status: 'incomplete' };
  assert.equal(applyOrderActivation(member, 'pay-first', paidAt, 'month'), true);
  const firstEnd = member.currentPeriodEnd.getTime();
  assert.equal(applyOrderActivation(member, 'pay-second', paidAt, 'month'), false);
  assert.equal(member.currentPeriodEnd.getTime(), firstEnd);
  assert.equal(member.razorpayCapturedPaymentId, 'pay-first');
});

test('duplicate webhook deliveries are acknowledged after completion and serialized while processing', () => {
  assert.equal(webhookDeliveryDecision('processed', null, now), 'processed');
  assert.equal(webhookDeliveryDecision('processing', new Date(now.getTime() + 1000), now), 'busy');
  assert.equal(webhookDeliveryDecision('processing', new Date(now.getTime() - 1000), now), 'claim');
  assert.equal(webhookDeliveryDecision('failed', null, now), 'claim');
});

test('a failed renewal cannot replace an already captured payment', () => {
  assert.deepEqual(paymentRecordFilter('pay-renewal', 'failed'), {
    razorpayPaymentId: 'pay-renewal',
    status: { $ne: 'paid' },
  });
  assert.equal(paymentStatusCanUpdate('paid', 'failed'), false);
  assert.equal(paymentStatusCanUpdate('failed', 'paid'), true);
});

test('a client retry returns the same booking without consuming another seat', async () => {
  MemorySession.reset({ capacity: 1 });
  MemoryBooking.reset();
  const firstReservation = await reserveClassSpot('session-1', 'member-a', now, MemorySession);
  const firstBooking = await materializeBooking('session-1', 'member-a', MemoryBooking);
  const retryReservation = await reserveClassSpot('session-1', 'member-a', now, MemorySession);
  const retryBooking = await materializeBooking('session-1', 'member-a', MemoryBooking);
  assert.equal(firstReservation.reserved, true);
  assert.equal(retryReservation.alreadyReserved, true);
  assert.equal(retryBooking._id, firstBooking._id);
  assert.equal(MemoryBooking.rows.size, 1);
  assert.equal(MemorySession.row.seatsBooked, 1);
});

test('repeating cancellation releases the seat only once', async () => {
  MemorySession.reset({ capacity: 1 });
  await reserveClassSpot('session-1', 'member-a', now, MemorySession);
  await releaseClassSpot('session-1', 'member-a', MemorySession);
  await releaseClassSpot('session-1', 'member-a', MemorySession);
  assert.equal(MemorySession.row.seatsBooked, 0);
  assert.deepEqual(MemorySession.row.reservedUserIds, []);
});

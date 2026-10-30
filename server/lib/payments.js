export function paymentRecordFilter(paymentId, status) {
  return status === 'paid'
    ? { razorpayPaymentId: paymentId }
    : { razorpayPaymentId: paymentId, status: { $ne: 'paid' } };
}

export function buildOrderMembershipActivation(membershipId, paymentId, paidAt, interval = 'month') {
  const unit = ({ month: 'month', year: 'year', week: 'week', day: 'day' })[interval] || 'month';
  return {
    filter: {
      _id: membershipId,
      activatedOrderPaymentIds: { $ne: paymentId },
      $or: [{ razorpayCapturedPaymentId: { $exists: false } }, { razorpayCapturedPaymentId: paymentId }],
    },
    update: [{ $set: {
      currentPeriodEnd: { $dateAdd: {
        startDate: { $max: [{ $ifNull: ['$currentPeriodEnd', paidAt] }, paidAt] },
        unit,
        amount: 1,
      } },
      status: 'active',
      cancelAtPeriodEnd: false,
      razorpayCapturedPaymentId: paymentId,
      activatedOrderPaymentIds: { $setUnion: [{ $ifNull: ['$activatedOrderPaymentIds', []] }, [paymentId]] },
    } }],
  };
}

export function paymentStatusCanUpdate(currentStatus, incomingStatus) {
  return currentStatus !== 'paid' || incomingStatus === 'paid';
}

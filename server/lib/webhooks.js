export function webhookDeliveryDecision(status, leaseExpiresAt, now = new Date()) {
  if (status === 'processed') return 'processed';
  if (status === 'processing' && leaseExpiresAt && new Date(leaseExpiresAt) > now) return 'busy';
  return 'claim';
}

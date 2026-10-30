import Razorpay from 'razorpay';
import { createHmac, timingSafeEqual } from 'node:crypto';

const keyId = () => process.env.RAZORPAY_KEY_ID || '';
const keySecret = () => process.env.RAZORPAY_KEY_SECRET || '';
let cachedClient;
let cachedKeyId = '';
let cachedKeySecret = '';

export const isRazorpayConfigured = () => Boolean(keyId() && keySecret());
export const getRazorpayKeyId = keyId;

function getClient() {
  const currentKeyId = keyId();
  const currentKeySecret = keySecret();
  if (!currentKeyId || !currentKeySecret) {
    const error = new Error('Payments are not configured yet. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env.');
    error.status = 503;
    throw error;
  }
  if (!cachedClient || cachedKeyId !== currentKeyId || cachedKeySecret !== currentKeySecret) {
    cachedClient = new Razorpay({ key_id: currentKeyId, key_secret: currentKeySecret });
    cachedKeyId = currentKeyId;
    cachedKeySecret = currentKeySecret;
  }
  return cachedClient;
}

async function callRazorpay(request) {
  const client = getClient();
  try {
    return await request(client);
  } catch (cause) {
    const providerError = cause?.error;
    const description = typeof providerError === 'string'
      ? providerError
      : providerError?.description || providerError?.reason || cause?.message;
    const statusCode = Number(cause?.statusCode || cause?.status || cause?.response?.status) || undefined;
    const code = providerError?.code || cause?.code;
    console.error('Razorpay request failed:', { statusCode, code });
    const safeDescription = statusCode === 401
      ? 'Razorpay rejected the server credentials. Check that the Test Mode Key ID and Key Secret are a matching pair, then restart the backend.'
      : description || 'Razorpay rejected the request. Check the server log and account settings.';
    const error = new Error(safeDescription);
    error.status = 502;
    throw error;
  }
}

export const createRazorpayOrder = (details) => callRazorpay((client) => client.orders.create(details));
export const fetchRazorpayOrdersByReceipt = (receipt) => callRazorpay((client) => client.orders.all({ receipt, count: 1 }));
export const listRazorpayOrderPayments = (orderId) => callRazorpay((client) => client.orders.fetchPayments(orderId));
export const createRazorpayPlan = (details) => callRazorpay((client) => client.plans.create(details));
export const createRazorpaySubscription = (details) => callRazorpay((client) => client.subscriptions.create(details));
export const fetchRazorpaySubscription = (subscriptionId) => callRazorpay((client) => client.subscriptions.fetch(subscriptionId));
export const fetchRazorpayPayment = (paymentId) => callRazorpay((client) => client.payments.fetch(paymentId));
export const fetchRazorpayOrder = (orderId) => callRazorpay((client) => client.orders.fetch(orderId));
export const cancelRazorpaySubscription = (subscriptionId, atCycleEnd = true) => callRazorpay((client) => client.subscriptions.cancel(subscriptionId, atCycleEnd));
export const resumeRazorpaySubscriptionRenewal = (subscriptionId) => callRazorpay((client) => client.subscriptions.cancelScheduledChanges(subscriptionId));

export function verifyRazorpaySignature(content, signature, secret = process.env.RAZORPAY_WEBHOOK_SECRET) {
  if (!content || !signature || !secret) return false;
  const expected = createHmac('sha256', secret).update(content).digest();
  let received;
  try { received = Buffer.from(signature, 'hex'); } catch { return false; }
  return received.length === expected.length && timingSafeEqual(received, expected);
}

import dotenv from 'dotenv';

// In local development, prefer the project .env over stale values inherited from an old terminal.
dotenv.config({ override: process.env.NODE_ENV !== 'production' });
import express from 'express';
import mongoose from 'mongoose';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { User, Membership, Session, Booking, Review, Notification, Payment, GatewayPlan, WebhookEvent } from './models/index.js';
import { plans, findPlan } from './config/plans.js';
import { notify, sendWelcomeEmail, sendPasswordResetEmail } from './lib/services.js';
import { seedDefaults } from './lib/seed.js';
import { cancelRazorpaySubscription, resumeRazorpaySubscriptionRenewal, createRazorpayOrder, createRazorpayPlan, createRazorpaySubscription, fetchRazorpayOrder, fetchRazorpayOrdersByReceipt, fetchRazorpayPayment, fetchRazorpaySubscription, getRazorpayKeyId, isRazorpayConfigured, listRazorpayOrderPayments, verifyRazorpaySignature } from './lib/razorpay.js';
import adminRouter from './routes/admin.js';
import { completeBookingCancellation, materializeBooking, migrateSessionReservations, releaseClassSpot, repairSessionReservations, reserveClassSpot } from './lib/bookings.js';
import { buildOrderMembershipActivation, paymentRecordFilter, paymentStatusCanUpdate } from './lib/payments.js';
import { webhookDeliveryDecision } from './lib/webhooks.js';

const app = express();
const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET;
const COOKIE_NAME = 'northstar_session';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const here = path.dirname(fileURLToPath(import.meta.url));

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('JWT_SECRET must be set to a random value of at least 32 characters.');
  process.exit(1);
}
if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is required.');
  process.exit(1);
}

app.set('trust proxy', 1);
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https://images.unsplash.com', 'https://*.googleusercontent.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      scriptSrc: ["'self'", 'https://checkout.razorpay.com'],
      connectSrc: ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com'],
      frameSrc: ['https://api.razorpay.com', 'https://checkout.razorpay.com'],
    },
  },
}));
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(cookieParser());

function addMembershipInterval(start, interval = 'month') {
  const end = new Date(start);
  if (interval === 'year') end.setFullYear(end.getFullYear() + 1);
  else if (interval === 'week') end.setDate(end.getDate() + 7);
  else if (interval === 'day') end.setDate(end.getDate() + 1);
  else end.setMonth(end.getMonth() + 1);
  return end;
}

async function savePaymentRecord(razorpayPaymentId, fields) {
  const current = await Payment.findOne({ razorpayPaymentId });
  if (current && !paymentStatusCanUpdate(current.status, fields.status)) return current;
  const filter = paymentRecordFilter(razorpayPaymentId, fields.status);
  const updated = await Payment.findOneAndUpdate(filter, { $set: fields }, { new: true });
  if (updated) return updated;
  const existing = await Payment.findOne({ razorpayPaymentId });
  if (existing) return existing;
  try {
    return await Payment.create({ ...fields, razorpayPaymentId });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    if (fields.status === 'paid') {
      return Payment.findOneAndUpdate({ razorpayPaymentId }, { $set: fields }, { new: true });
    }
    return (await Payment.findOneAndUpdate({ razorpayPaymentId, status: { $ne: 'paid' } }, { $set: fields }, { new: true }))
      || Payment.findOne({ razorpayPaymentId });
  }
}

async function recordCapturedOrderPayment(membership, payment, eventId = payment.id) {
  const plan = findPlan(membership.planId);
  const expectedAmount = Math.round(Number(plan?.price || 0) * 100);
  const expectedCurrency = String(plan?.currency || 'INR').toUpperCase();
  if (!plan || payment.status !== 'captured' || payment.order_id !== membership.razorpayOrderId || Number(payment.amount) !== expectedAmount || String(payment.currency).toUpperCase() !== expectedCurrency) {
    throw Object.assign(new Error('Captured Razorpay payment does not match its membership order.'), { status: 400 });
  }
  const paidAt = payment.created_at ? new Date(payment.created_at * 1000) : new Date();
  const interval = plan?.interval || 'month';
  const activation = buildOrderMembershipActivation(membership._id, payment.id, paidAt, interval);
  await Membership.updateOne(activation.filter, activation.update);
  const current = await Membership.findById(membership._id).select('razorpayCapturedPaymentId activatedOrderPaymentIds');
  const alreadyApplied = current?.razorpayCapturedPaymentId === payment.id || current?.activatedOrderPaymentIds?.includes(payment.id);
  const duplicate = Boolean(current?.razorpayCapturedPaymentId && current.razorpayCapturedPaymentId !== payment.id)
    || Boolean(current && !alreadyApplied);

  await savePaymentRecord(payment.id, {
    user: membership.user,
    razorpayOrderId: payment.order_id,
    amount: Number(payment.amount || 0) / 100,
    currency: String(payment.currency || plan?.currency || 'INR').toLowerCase(),
    status: 'paid',
    description: (plan?.name || 'Northstar') + ' membership',
  });
  if (duplicate) console.error('A second captured payment was received for one membership order:', { orderId: payment.order_id, paymentId: payment.id, membershipId: String(membership._id) });
  if (membership.user && !duplicate) {
    await notify(membership.user, 'You are all set', 'Your ' + (plan?.name || 'Northstar') + ' membership is active. Welcome to Northstar.', 'success', 'order-activated:' + payment.id);
  }
  return { duplicate };
}

async function processRazorpayEvent(event, eventId) {
  const subscription = event.payload?.subscription?.entity;
  const payment = event.payload?.payment?.entity;
  const eventStatus = {
    'subscription.activated': 'active',
    'subscription.authenticated': 'active',
    'subscription.charged': 'active',
    'subscription.pending': 'past_due',
    'subscription.halted': 'past_due',
    'subscription.paused': 'past_due',
    'subscription.resumed': 'active',
    'subscription.cancelled': 'canceled',
    'subscription.completed': 'canceled',
  }[event.event];

  if (subscription?.id && eventStatus) {
    const membership = await Membership.findOne({ razorpaySubscriptionId: subscription.id });
    if (membership) {
      const wasStatus = membership.status;
      const eventAt = event.created_at ? new Date(event.created_at * 1000) : new Date();
      const updates = { status: eventStatus, lastRazorpayEventAt: eventAt };
      if (subscription.current_end) updates.currentPeriodEnd = new Date(subscription.current_end * 1000);
      if (subscription.customer_id) updates.razorpayCustomerId = subscription.customer_id;
      if (typeof subscription.has_scheduled_changes === 'boolean') updates.cancelAtPeriodEnd = subscription.has_scheduled_changes;
      const stateUpdate = await Membership.updateOne(
        { _id: membership._id, $or: [{ lastRazorpayEventAt: { $exists: false } }, { lastRazorpayEventAt: null }, { lastRazorpayEventAt: { $lte: eventAt } }] },
        { $set: updates },
      );
      const stateWasApplied = stateUpdate.matchedCount > 0;

      if (event.event === 'subscription.charged' && payment?.id) {
        const plan = findPlan(membership.planId);
        await savePaymentRecord(payment.id, {
          user: membership.user,
          razorpaySubscriptionId: subscription.id,
          amount: Number(payment.amount || 0) / 100,
          currency: String(payment.currency || plan?.currency || 'INR').toLowerCase(),
          status: payment.status === 'captured' ? 'paid' : 'pending',
          description: (plan?.name || 'Northstar') + ' membership',
        });
      }

      if (stateWasApplied && membership.user && eventStatus === 'active' && (wasStatus !== 'active' || ['subscription.activated', 'subscription.authenticated'].includes(event.event))) {
        const plan = findPlan(membership.planId);
        await notify(membership.user, 'You are all set', 'Your ' + (plan?.name || 'Northstar') + ' membership is active. Welcome to Northstar.', 'success', 'subscription-active:' + subscription.id);
      } else if (stateWasApplied && membership.user && ['past_due', 'canceled'].includes(eventStatus)) {
        await notify(membership.user, eventStatus === 'canceled' ? 'Membership updated' : 'Payment needs attention', eventStatus === 'canceled' ? 'Your membership has ended.' : 'Your latest membership payment needs attention.', 'billing', 'subscription-state:' + subscription.id + ':' + eventStatus + ':' + (subscription.current_end || ''));
      }
    }
  }

  if (event.event === 'payment.captured' && payment?.id && payment.order_id) {
    const membership = await Membership.findOne({ razorpayOrderId: payment.order_id });
    if (membership) await recordCapturedOrderPayment(membership, payment, eventId);
  }

  if (event.event === 'payment.failed' && payment?.id && payment.order_id) {
    const membership = await Membership.findOne({ razorpayOrderId: payment.order_id });
    if (membership) {
      const plan = findPlan(membership.planId);
      await savePaymentRecord(payment.id, {
        user: membership.user,
        razorpayOrderId: payment.order_id,
        amount: Number(payment.amount || 0) / 100,
        currency: String(payment.currency || plan?.currency || 'INR').toLowerCase(),
        status: 'failed',
        description: (plan?.name || 'Northstar') + ' membership',
      });
      if (membership.user) await notify(membership.user, 'Payment not completed', 'Your membership payment did not go through. You can try again when ready.', 'billing', 'payment-failed:' + payment.id);
    }
  }

  if (event.event === 'payment.captured' && payment?.id && payment.subscription_id) {
    const membership = await Membership.findOne({ razorpaySubscriptionId: payment.subscription_id });
    if (membership) {
      const plan = findPlan(membership.planId);
      await savePaymentRecord(payment.id, {
        user: membership.user,
        razorpaySubscriptionId: payment.subscription_id,
        amount: Number(payment.amount || 0) / 100,
        currency: String(payment.currency || plan?.currency || 'INR').toLowerCase(),
        status: 'paid',
        description: (plan?.name || 'Northstar') + ' membership',
      });
    }
  }

  if (event.event === 'payment.failed' && payment?.id && payment.subscription_id) {
    const membership = await Membership.findOne({ razorpaySubscriptionId: payment.subscription_id });
    if (membership) {
      const plan = findPlan(membership.planId);
      await savePaymentRecord(payment.id, {
        user: membership.user,
        razorpaySubscriptionId: payment.subscription_id,
        amount: Number(payment.amount || 0) / 100,
        currency: String(payment.currency || plan?.currency || 'INR').toLowerCase(),
        status: 'failed',
        description: (plan?.name || 'Northstar') + ' membership',
      });
      if (membership.user) await notify(membership.user, 'Renewal payment needs attention', 'Your latest membership renewal did not go through. Check your Razorpay payment method or contact the club.', 'billing', 'renewal-failed:' + payment.id);
    }
  }
}

const WEBHOOK_LEASE_MS = 30 * 1000;

async function processStoredWebhook(eventId) {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + WEBHOOK_LEASE_MS);
  const current = await WebhookEvent.findOne({ eventId }).select('status leaseExpiresAt').lean();
  const decision = webhookDeliveryDecision(current?.status, current?.leaseExpiresAt, now);
  if (decision !== 'claim') return decision;

  const claimed = await WebhookEvent.findOneAndUpdate(
    {
      eventId,
      $or: [
        { status: { $in: ['pending', 'failed'] } },
        { status: 'processing', leaseExpiresAt: { $lte: now } },
        { status: 'processing', leaseExpiresAt: { $exists: false } },
      ],
    },
    { $set: { status: 'processing', leaseExpiresAt, lastError: '' }, $inc: { attempts: 1 } },
    { new: true },
  );
  if (!claimed) {
    const latest = await WebhookEvent.findOne({ eventId }).lean();
    return latest?.status === 'processed' ? 'processed' : 'busy';
  }

  try {
    await processRazorpayEvent(claimed.payload, eventId);
    await WebhookEvent.updateOne({ eventId, status: 'processing' }, { $set: { status: 'processed', processedAt: new Date() }, $unset: { leaseExpiresAt: 1, lastError: 1 } });
    return 'processed';
  } catch (error) {
    await WebhookEvent.updateOne({ eventId, status: 'processing' }, { $set: { status: 'failed', lastError: String(error?.message || 'Webhook processing failed.').slice(0, 500) }, $unset: { leaseExpiresAt: 1 } });
    throw error;
  }
}

async function persistWebhook(eventId, event) {
  try {
    await WebhookEvent.findOneAndUpdate(
      { eventId },
      { $setOnInsert: { eventId, event: event.event || 'unknown', payload: event, status: 'pending' } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
}

async function retryStoredWebhooks() {
  const now = new Date();
  const due = await WebhookEvent.find({ $or: [
    { status: { $in: ['pending', 'failed'] } },
    { status: 'processing', leaseExpiresAt: { $lte: now } },
    { status: 'processing', leaseExpiresAt: { $exists: false } },
  ] }).select('eventId').limit(50).lean();
  for (const item of due) {
    try { await processStoredWebhook(item.eventId); }
    catch (error) { console.error('Webhook recovery failed for event ' + item.eventId + ':', error.message); }
  }
}

app.post('/api/payments/webhook', express.raw({ type: 'application/json', limit: '128kb' }), async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.headers['x-razorpay-signature'];
  if (!secret) return res.status(503).send('Razorpay webhook is not configured.');
  if (!verifyRazorpaySignature(req.body, signature, secret)) return res.status(400).send('Invalid Razorpay webhook signature.');

  let event;
  try { event = JSON.parse(req.body.toString('utf8')); }
  catch { return res.status(400).send('Invalid webhook payload.'); }
  const eventId = String(req.headers['x-razorpay-event-id'] || event.id || '').trim();
  if (!eventId || eventId.length > 200) return res.status(400).send('A valid Razorpay event ID is required.');

  try {
    await persistWebhook(eventId, event);
    const status = await processStoredWebhook(eventId);
    if (status === 'busy') return res.status(503).send('Webhook event is already being processed.');
    return res.json({ received: true });
  } catch (error) {
    console.error('Razorpay webhook handler failed:', error);
    return res.status(500).send('Webhook processing failed.');
  }
});

app.use(express.json({ limit: '64kb' }));
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many attempts. Please try again in a few minutes.' } });
const authSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
});
const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(8).max(128) });

function publicUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone || '',
    goal: user.goal || '',
    avatar: user.avatar || '',
    createdAt: user.createdAt,
  };
}
function issueCookie(res, user) {
  const token = jwt.sign({ sub: String(user._id), ver: user.authVersion || 0 }, JWT_SECRET, { expiresIn: '7d', issuer: 'northstar' });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });
}
function clearCookie(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
}
async function authRequired(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Please sign in to continue.' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { issuer: 'northstar' });
    const user = await User.findById(decoded.sub).select('name email role phone goal avatar disabled createdAt authVersion');
    if (!user || user.disabled || (decoded.ver || 0) !== (user.authVersion || 0)) {
      clearCookie(res);
      return res.status(401).json({ error: 'This account is unavailable.' });
    }
    req.user = user;
    return next();
  } catch {
    clearCookie(res);
    return res.status(401).json({ error: 'Your session expired. Please sign in again.' });
  }
}
function adminRequired(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
  next();
}
function handleError(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error?.name === 'ZodError') return res.status(400).json({ error: error.issues[0]?.message || 'Please check the submitted information.' });
  if (error?.code === 11000) return res.status(409).json({ error: 'That record already exists.' });
  if (error?.name === 'CastError') return res.status(400).json({ error: 'Invalid record identifier.' });
  console.error(error);
  return res.status(error.status || 500).json({ error: error.status ? error.message : 'Something went wrong. Please try again.' });
}
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'northstar-api' }));
app.get('/api/plans', (req, res) => res.json({ data: plans }));

app.post('/api/auth/signup', authLimiter, asyncRoute(async (req, res) => {
  const input = authSchema.parse(req.body);
  const email = input.email.toLowerCase();
  if (await User.exists({ email })) return res.status(409).json({ error: 'An account already exists for this email.' });
  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await User.create({ name: input.name, email, passwordHash });
  issueCookie(res, user);
  await notify(user._id, 'Welcome to Northstar', 'Your account is ready. Find a class and get your first session on the calendar.', 'success');
  try { await sendWelcomeEmail(user); } catch (error) { console.error('Welcome email delivery failed:', error.message); }
  return res.status(201).json({ data: { user: publicUser(user) } });
}));

app.post('/api/auth/login', authLimiter, asyncRoute(async (req, res) => {
  const input = loginSchema.parse(req.body);
  const user = await User.findOne({ email: input.email.toLowerCase() }).select('+passwordHash');
  if (!user || user.disabled || !(await bcrypt.compare(input.password, user.passwordHash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
  issueCookie(res, user);
  return res.json({ data: { user: publicUser(user) } });
}));

app.post('/api/auth/forgot-password', authLimiter, asyncRoute(async (req, res) => {
  const parsed = z.object({ email: z.string().trim().email().max(254) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email address.' });
  const user = await User.findOne({ email: parsed.data.email.toLowerCase() });
  if (user && !user.disabled) {
    const token = randomBytes(32).toString('hex');
    user.passwordResetTokenHash = createHash('sha256').update(token).digest('hex');
    user.passwordResetExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await user.save();
    const base = process.env.NODE_ENV === 'development' ? (req.get('origin') || process.env.APP_URL || 'http://localhost:5173') : (process.env.APP_URL || 'http://localhost:5173');
    const resetUrl = new URL('/reset-password', base);
    resetUrl.searchParams.set('token', token);
    try { await sendPasswordResetEmail(user, resetUrl.toString()); }
    catch (error) { console.error('Password reset email delivery failed:', error.message); }
  }
  return res.json({ data: { message: 'If an account exists for that email, a password reset link is on its way.' } });
}));

app.post('/api/auth/reset-password', authLimiter, asyncRoute(async (req, res) => {
  const parsed = z.object({ token: z.string().length(64), password: z.string().min(8).max(128) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Use a valid reset link and a password with at least 8 characters.' });
  const tokenHash = createHash('sha256').update(parsed.data.token).digest('hex');
  const user = await User.findOne({ passwordResetTokenHash: tokenHash, passwordResetExpiresAt: { $gt: new Date() }, disabled: false }).select('+passwordHash +passwordResetTokenHash +passwordResetExpiresAt');
  if (!user) return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });
  user.passwordHash = await bcrypt.hash(parsed.data.password, 12);
  user.passwordResetTokenHash = undefined;
  user.passwordResetExpiresAt = undefined;
  user.authVersion = (user.authVersion || 0) + 1;
  await user.save();
  clearCookie(res);
  return res.json({ data: { success: true, message: 'Password updated. Sign in with your new password.' } });
}));

app.post('/api/auth/logout', (req, res) => { clearCookie(res); res.json({ data: { success: true } }); });
app.get('/api/auth/me', authRequired, asyncRoute(async (req, res) => res.json({ data: { user: publicUser(req.user) } })));

app.get('/api/profile', authRequired, asyncRoute(async (req, res) => {
  const membership = await Membership.findOne({ user: req.user._id }).sort({ createdAt: -1 });
  if (membership?.razorpayOrderId && membership.status === 'active' && membership.currentPeriodEnd <= new Date()) {
    membership.status = 'canceled';
    await membership.save();
    await notify(req.user._id, 'Membership ended', 'Your monthly membership has ended. Renew whenever you are ready.', 'billing');
  }
  return res.json({ data: { user: publicUser(req.user), membership: membership ? { ...membership.toObject(), plan: findPlan(membership.planId) } : null } });
}));

app.delete('/api/account', authRequired, asyncRoute(async (req, res) => {
  const parsed = z.object({ password: z.string().min(8).max(128), confirmation: z.literal('DELETE') }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter your password and type DELETE to confirm account removal.' });
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) return res.status(401).json({ error: 'Your password is incorrect.' });

  const memberships = await Membership.find({ user: user._id, razorpaySubscriptionId: { $exists: true, $ne: '' }, status: { $in: ['incomplete', 'active', 'trialing', 'past_due'] } });
  for (const membership of memberships) {
    if (!isRazorpayConfigured()) return res.status(503).json({ error: 'Payments are not configured, so we could not safely stop auto-renewal. Contact the club before deleting your account.' });
    try {
      const atCycleEnd = ['active', 'trialing', 'past_due'].includes(membership.status) && membership.currentPeriodEnd && membership.currentPeriodEnd > new Date();
      const subscription = await cancelRazorpaySubscription(membership.razorpaySubscriptionId, Boolean(atCycleEnd));
      membership.cancelAtPeriodEnd = Boolean(atCycleEnd);
      if (!atCycleEnd) membership.status = 'canceled';
      if (subscription.current_end) membership.currentPeriodEnd = new Date(subscription.current_end * 1000);
      await membership.save();
    } catch (error) {
      return res.status(502).json({ error: 'We could not stop your Razorpay subscription, so the account was kept open. Please try again or contact the club.' });
    }
  }

  const affectedSessionIds = new Set([
    ...await Booking.find({ user: user._id }).distinct('session'),
    ...await Session.find({ reservedUserIds: user._id }).distinct('_id'),
  ].map(String));
  await Booking.updateMany({ user: user._id, status: 'booked' }, { $set: { cancelRequestedAt: new Date() } });
  const activeBookings = await Booking.find({ user: user._id, cancelRequestedAt: { $exists: true } }).select('_id session user');
  for (const booking of activeBookings) await completeBookingCancellation(booking);
  for (const sessionId of affectedSessionIds) await releaseClassSpot(sessionId, user._id);
  await Booking.deleteMany({ user: user._id });
  for (const sessionId of affectedSessionIds) {
    const activeUsers = await Booking.find({ session: sessionId, status: 'booked' }).distinct('user');
    await Session.updateOne({ _id: sessionId }, { $set: { seatsBooked: activeUsers.length, reservedUserIds: activeUsers } });
  }
  await Promise.all([
    Review.deleteMany({ user: user._id }),
    Notification.deleteMany({ user: user._id }),
    Membership.updateMany({ user: user._id }, { $unset: { user: 1 } }),
    Payment.updateMany({ user: user._id }, { $unset: { user: 1 } }),
  ]);
  await User.deleteOne({ _id: user._id });
  clearCookie(res);
  return res.json({ data: { success: true } });
}));

app.patch('/api/profile', authRequired, asyncRoute(async (req, res) => {
  const schema = z.object({ name: z.string().trim().min(2).max(80), phone: z.string().trim().max(40).optional(), goal: z.string().trim().max(160).optional() }).strict();
  const updates = schema.parse(req.body);
  const user = await User.findByIdAndUpdate(req.user._id, { $set: updates }, { new: true, runValidators: true });
  await notify(user._id, 'Profile saved', 'Your member details have been updated.', 'info');
  return res.json({ data: { user: publicUser(user) } });
}));

app.get('/api/sessions', asyncRoute(async (req, res) => {
  const from = new Date();
  const until = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const sessions = await Session.find({ published: true, date: { $gte: from, $lte: until } }).sort({ date: 1 }).limit(100).lean();
  const ids = sessions.map((item) => item._id);
  const booked = await Booking.aggregate([{ $match: { session: { $in: ids }, status: 'booked' } }, { $group: { _id: '$session', count: { $sum: 1 } } }]);
  const counts = new Map(booked.map((item) => [String(item._id), item.count]));
  return res.json({ data: sessions.map((item) => ({ ...item, seatsBooked: counts.get(String(item._id)) || item.seatsBooked || 0 })) });
}));

app.post('/api/sessions/:id/book', authRequired, asyncRoute(async (req, res) => {
  const priorBooking = await Booking.findOne({ session: req.params.id, user: req.user._id });
  if (priorBooking?.status === 'booked' && !priorBooking.cancelRequestedAt) return res.json({ data: { booking: priorBooking } });
  if (priorBooking?.cancelRequestedAt) return res.status(409).json({ error: 'Your cancellation is still being completed. Try booking again in a moment.' });

  const membership = await Membership.findOne({ user: req.user._id, status: { $in: ['active', 'trialing'] } }).sort({ createdAt: -1 });
  if (!membership) return res.status(403).json({ error: 'An active membership is needed to book a class. Choose a plan in Membership & billing.' });
  if (membership.planId === 'essential') {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const monthSessions = await Session.find({ date: { $gte: monthStart, $lt: monthEnd } }).distinct('_id');
    const used = await Booking.countDocuments({ user: req.user._id, session: { $in: monthSessions }, status: { $in: ['booked', 'attended'] } });
    if (used >= 2) return res.status(403).json({ error: 'Your Essential plan includes 2 group classes each month. Upgrade for unlimited class bookings.' });
  }

  const reservation = await reserveClassSpot(req.params.id, req.user._id);
  if (!reservation.reserved) return res.status(409).json({ error: 'This class is full or no longer available.' });
  const booking = await materializeBooking(req.params.id, req.user._id);
  if (!booking || booking.status !== 'booked' || booking.cancelRequestedAt) {
    return res.status(409).json({ error: 'This booking is changing. Refresh your schedule and try again.' });
  }
  await notify(req.user._id, 'Class booked', 'You are booked for ' + reservation.session.title + '. See you in ' + reservation.session.room + '.', 'class', 'class-booked:' + reservation.session._id + ':' + req.user._id);
  return res.status(priorBooking ? 200 : 201).json({ data: { booking } });
}));

app.delete('/api/sessions/:id/book', authRequired, asyncRoute(async (req, res) => {
  const booking = await Booking.findOne({ session: req.params.id, user: req.user._id }).populate('session');
  if (!booking || booking.status === 'cancelled') return res.json({ data: { success: true } });
  if (booking.status !== 'booked') return res.status(409).json({ error: 'This booking can no longer be cancelled.' });
  if (booking.session.date.getTime() - Date.now() < 2 * 60 * 60 * 1000) return res.status(409).json({ error: 'Classes can be cancelled up to 2 hours before they start.' });

  await Booking.updateOne({ _id: booking._id, status: 'booked' }, { $set: { cancelRequestedAt: new Date() } });
  await completeBookingCancellation(booking);
  await notify(req.user._id, 'Booking cancelled', 'Your spot in ' + booking.session.title + ' has been released.', 'info', 'class-cancelled:' + booking.session._id + ':' + req.user._id);
  return res.json({ data: { success: true } });
}));

app.get('/api/me/bookings', authRequired, asyncRoute(async (req, res) => {
  const bookings = await Booking.find({ user: req.user._id }).populate('session').sort({ createdAt: -1 }).limit(100).lean();
  return res.json({ data: bookings });
}));

app.post('/api/sessions/:id/reviews', authRequired, asyncRoute(async (req, res) => {
  const input = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(800).optional().default('') }).parse(req.body);
  const session = await Session.findOne({ _id: req.params.id, date: { $lt: new Date() } });
  if (!session) return res.status(400).json({ error: 'Reviews open after a class has finished.' });
  const booking = await Booking.findOne({ session: session._id, user: req.user._id, status: { $in: ['booked', 'attended'] } });
  if (!booking) return res.status(403).json({ error: 'Book this class before leaving a review.' });
  const review = await Review.create({ session: session._id, user: req.user._id, ...input });
  return res.status(201).json({ data: { review } });
}));

app.get('/api/reviews', asyncRoute(async (req, res) => {
  const reviews = await Review.find().populate('user', 'name').populate('session', 'title category date').sort({ createdAt: -1 }).limit(8).lean();
  return res.json({ data: reviews });
}));

app.get('/api/notifications', authRequired, asyncRoute(async (req, res) => {
  const items = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(40).lean();
  return res.json({ data: items, unread: items.filter((item) => !item.readAt).length });
}));
app.post('/api/notifications/read-all', authRequired, asyncRoute(async (req, res) => {
  await Notification.updateMany({ user: req.user._id, readAt: null }, { $set: { readAt: new Date() } });
  return res.json({ data: { success: true } });
}));

app.get('/api/payments/history', authRequired, asyncRoute(async (req, res) => {
  const items = await Payment.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50).lean();
  return res.json({ data: items });
}));

async function getOrCreateRazorpayPlan(plan) {
  const amount = Math.round(Number(plan.price) * 100);
  const currency = String(plan.currency || 'INR').toUpperCase();
  const mode = String(process.env.RAZORPAY_KEY_ID || '').startsWith('rzp_live_') ? 'live' : 'test';
  const selector = { planId: plan.id, currency, amount, mode };
  const cached = await GatewayPlan.findOne(selector);
  if (cached) return cached.razorpayPlanId;
  const created = await createRazorpayPlan({
    period: 'monthly',
    interval: 1,
    item: { name: plan.name + ' Membership', amount, currency, description: plan.description },
    notes: { northstar_plan_id: plan.id },
  });
  if (!created?.id) throw Object.assign(new Error('Razorpay did not return a billing plan.'), { status: 502 });
  const stored = await GatewayPlan.findOneAndUpdate(selector, { $setOnInsert: { ...selector, razorpayPlanId: created.id } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  return stored.razorpayPlanId;
}

function subscriptionCheckoutData(subscription, plan) {
  return { key_id: getRazorpayKeyId(), subscription_id: subscription.id, planName: plan.name, amount: Math.round(Number(plan.price) * 100), currency: String(plan.currency || 'INR').toUpperCase() };
}

function orderCheckoutData(order, plan) {
  return { key_id: getRazorpayKeyId(), order_id: order.id, planName: plan.name, amount: order.amount, currency: order.currency };
}

async function reconcilePaidOrder(order, membership) {
  const result = await listRazorpayOrderPayments(order.id);
  const payment = (result.items || []).find((item) => item.order_id === order.id && item.status === 'captured');
  if (payment) await recordCapturedOrderPayment(membership, payment);
}

app.post('/api/create-subscription', authRequired, asyncRoute(async (req, res) => {
  const parsed = z.object({ planId: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Choose a valid membership plan.' });
  const plan = findPlan(parsed.data.planId);
  if (!plan) return res.status(400).json({ error: 'Choose a valid membership plan.' });
  if (!isRazorpayConfigured()) return res.status(503).json({ error: 'Payments are not configured yet. Add Razorpay test credentials to the server .env.' });
  const amount = Math.round(Number(plan.price) * 100);
  if (!Number.isSafeInteger(amount) || amount < 100) return res.status(400).json({ error: 'Membership price must be at least 100 paise.' });

  const now = new Date();
  await Membership.updateMany({ user: req.user._id, status: 'active', razorpayOrderId: { $exists: true }, razorpaySubscriptionId: { $exists: false }, currentPeriodEnd: { $lte: now } }, { $set: { status: 'canceled' } });
  const current = await Membership.findOne({ user: req.user._id, status: { $in: ['active', 'trialing', 'past_due'] } }).sort({ createdAt: -1 });
  if (current && (current.razorpaySubscriptionId || !current.currentPeriodEnd || current.currentPeriodEnd > now)) return res.status(409).json({ error: 'You already have a membership. Manage auto-renewal in Membership & billing.' });
  await Membership.updateMany({ user: req.user._id, status: 'incomplete', razorpayOrderId: { $exists: true }, createdAt: { $lte: new Date(now.getTime() - 30 * 60 * 1000) } }, { $set: { status: 'canceled' } });
  const olderCheckout = await Membership.findOne({ user: req.user._id, status: 'incomplete', razorpayOrderId: { $exists: true } });
  if (olderCheckout) return res.status(409).json({ error: 'A payment from an earlier checkout is still pending. Refresh your membership page before starting another checkout.' });

  const pending = await Membership.findOne({ user: req.user._id, status: 'incomplete', razorpaySubscriptionId: { $exists: true, $ne: '' } }).sort({ createdAt: -1 });
  if (pending) {
    const remote = await fetchRazorpaySubscription(pending.razorpaySubscriptionId);
    if (['authenticated', 'active'].includes(remote.status)) {
      pending.status = 'active';
      if (remote.current_end) pending.currentPeriodEnd = new Date(remote.current_end * 1000);
      pending.cancelAtPeriodEnd = Boolean(remote.has_scheduled_changes);
      await pending.save();
      return res.status(409).json({ error: 'Your membership is already active. Refresh this page to see it.' });
    }
    if (['created', 'pending'].includes(remote.status)) {
      if (pending.planId !== plan.id) return res.status(409).json({ error: 'A checkout is already waiting for this account. Finish or close it before choosing another plan.' });
      return res.json({ data: subscriptionCheckoutData(remote, plan) });
    }
    pending.status = 'canceled';
    await pending.save();
  }

  const lockUntil = new Date(now.getTime() + 5 * 60 * 1000);
  const locked = await User.findOneAndUpdate({ _id: req.user._id, $or: [{ checkoutLockExpiresAt: { $lte: now } }, { checkoutLockExpiresAt: { $exists: false } }] }, { $set: { checkoutLockPlanId: plan.id, checkoutLockExpiresAt: lockUntil } }, { new: true });
  if (!locked) return res.status(409).json({ error: 'A checkout is already starting for this account. Wait a moment and try again.' });

  try {
    const razorpayPlanId = await getOrCreateRazorpayPlan(plan);
    const subscription = await createRazorpaySubscription({ plan_id: razorpayPlanId, total_count: 1200, quantity: 1, customer_notify: true, notes: { userId: String(req.user._id), planId: plan.id } });
    if (!subscription?.id) throw Object.assign(new Error('Razorpay did not return a subscription.'), { status: 502 });
    await Membership.create({ user: req.user._id, planId: plan.id, status: 'incomplete', razorpaySubscriptionId: subscription.id, checkoutStartedAt: new Date() });
    return res.status(201).json({ data: subscriptionCheckoutData(subscription, plan) });
  } finally {
    await User.updateOne({ _id: req.user._id }, { $unset: { checkoutLockPlanId: 1, checkoutLockExpiresAt: 1 } });
  }
}));

app.post('/api/verify-subscription', authRequired, asyncRoute(async (req, res) => {
  const parsed = z.object({ razorpay_payment_id: z.string().min(1), razorpay_subscription_id: z.string().min(1), razorpay_signature: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Payment ID, subscription ID, and signature are required.' });
  const { razorpay_payment_id: paymentId, razorpay_subscription_id: subscriptionId, razorpay_signature: signature } = parsed.data;
  const membership = await Membership.findOne({ user: req.user._id, razorpaySubscriptionId: subscriptionId });
  if (!membership) return res.status(404).json({ error: 'This subscription was not found for your account.' });
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return res.status(503).json({ error: 'Razorpay is not configured on the server.' });
  const expected = createHmac('sha256', secret).update(paymentId + '|' + subscriptionId).digest();
  let received;
  try { received = Buffer.from(signature, 'hex'); } catch { received = Buffer.alloc(0); }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return res.status(400).json({ error: 'Razorpay could not verify this subscription.' });

  const [subscription, payment] = await Promise.all([fetchRazorpaySubscription(subscriptionId), fetchRazorpayPayment(paymentId)]);
  const plan = findPlan(membership.planId);
  const mode = String(process.env.RAZORPAY_KEY_ID || '').startsWith('rzp_live_') ? 'live' : 'test';
  const savedPlan = plan && await GatewayPlan.findOne({ planId: membership.planId, currency: String(plan.currency || 'INR').toUpperCase(), amount: Math.round(Number(plan.price || 0) * 100), mode });
  if (!plan || !savedPlan || subscription.plan_id !== savedPlan.razorpayPlanId) return res.status(400).json({ error: 'The subscription does not match this membership plan.' });
  if (!['authenticated', 'active'].includes(subscription.status)) return res.status(409).json({ error: 'Razorpay is still setting up your subscription. We will update your membership as soon as it is ready.' });

  membership.status = 'active';
  membership.cancelAtPeriodEnd = Boolean(subscription.has_scheduled_changes);
  if (subscription.current_end) membership.currentPeriodEnd = new Date(subscription.current_end * 1000);
  else if (!membership.currentPeriodEnd) membership.currentPeriodEnd = addMembershipInterval(new Date());
  await membership.save();
  if (payment.status === 'captured') {
    await Payment.findOneAndUpdate({ razorpayPaymentId: payment.id }, { $set: { user: membership.user, razorpaySubscriptionId: subscriptionId, amount: Number(payment.amount || 0) / 100, currency: String(payment.currency || plan.currency).toLowerCase(), status: 'paid', description: plan.name + ' membership' } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  }
  await notify(req.user._id, 'Auto-renew is on', 'Your ' + plan.name + ' membership is active and renews monthly. You can cancel renewal any time in Membership & billing.', 'success', 'subscription-active:' + subscriptionId);
  return res.json({ data: { membership } });
}));

app.post('/api/create-order', authRequired, asyncRoute(async (req, res) => {
  const parsed = z.object({ planId: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Choose a valid membership plan.' });
  const plan = findPlan(parsed.data.planId);
  if (!plan) return res.status(400).json({ error: 'Choose a valid membership plan.' });
  if (!isRazorpayConfigured()) return res.status(503).json({ error: 'Payments are not configured yet. Add the Razorpay test keys to the project .env and restart the backend.' });
  const amount = Math.round(Number(plan.price) * 100);
  const currency = String(plan.currency || 'INR').toUpperCase();
  if (!Number.isSafeInteger(amount) || amount < 100) return res.status(400).json({ error: 'Membership price must be at least 100 paise.' });

  const now = new Date();
  await Membership.updateMany({ user: req.user._id, status: 'active', razorpayOrderId: { $exists: true }, currentPeriodEnd: { $lte: now } }, { $set: { status: 'canceled' } });
  const current = await Membership.findOne({ user: req.user._id, status: { $in: ['active', 'trialing', 'past_due'] } }).sort({ createdAt: -1 });
  if (current && (current.razorpaySubscriptionId || !current.currentPeriodEnd || current.currentPeriodEnd > now)) {
    return res.status(409).json({ error: 'You already have a membership. Manage it in Membership & billing before starting another checkout.' });
  }
  const pendingSubscription = await Membership.findOne({ user: req.user._id, status: 'incomplete', razorpaySubscriptionId: { $exists: true, $ne: '' } });
  if (pendingSubscription) return res.status(409).json({ error: 'A previous subscription checkout is still awaiting confirmation. Refresh your membership page or contact the club before paying again.' });

  const lockUntil = new Date(now.getTime() + 5 * 60 * 1000);
  const locked = await User.findOneAndUpdate(
    { _id: req.user._id, $or: [{ checkoutLockExpiresAt: { $lte: now } }, { checkoutLockExpiresAt: { $exists: false } }] },
    { $set: { checkoutLockPlanId: plan.id, checkoutLockExpiresAt: lockUntil } },
    { new: true },
  );
  if (!locked) return res.status(409).json({ error: 'A checkout is already starting for this account. Wait a moment and try again.' });

  try {
    let pending = await Membership.findOne({
      user: req.user._id,
      status: 'incomplete',
      $or: [
        { razorpayOrderId: { $exists: true, $ne: '' } },
        { checkoutReceipt: { $exists: true, $ne: '' } },
      ],
    }).sort({ createdAt: -1 });
    if (pending && pending.planId !== plan.id) return res.status(409).json({ error: 'A payment from an earlier checkout is still pending. Finish or close it before choosing another plan.' });

    let createdReservation = false;
    if (!pending) {
      const receipt = 'ns_' + randomBytes(16).toString('hex');
      pending = await Membership.create({ user: req.user._id, planId: plan.id, status: 'incomplete', checkoutReceipt: receipt, checkoutStartedAt: new Date() });
      createdReservation = true;
    }

    let order = pending.razorpayOrderId ? await fetchRazorpayOrder(pending.razorpayOrderId) : null;
    if (!order && !createdReservation) {
      const recovered = await fetchRazorpayOrdersByReceipt(pending.checkoutReceipt);
      order = recovered.items?.[0] || null;
    }
    if (!order) {
      order = await createRazorpayOrder({
        amount,
        currency,
        receipt: pending.checkoutReceipt,
        notes: { userId: String(req.user._id), planId: plan.id, membershipId: String(pending._id) },
      });
    }
    if (!order?.id || Number(order.amount) !== amount || String(order.currency).toUpperCase() !== currency) {
      throw Object.assign(new Error('Razorpay returned an order that does not match this membership.'), { status: 502 });
    }
    if (String(pending.razorpayOrderId || '') !== order.id) {
      pending.razorpayOrderId = order.id;
      await pending.save();
    }
    if (order.status === 'paid') {
      await reconcilePaidOrder(order, pending);
      return res.status(409).json({ error: 'This order has already been paid. We are syncing your membership; refresh Membership & billing in a moment.' });
    }
    return res.status(createdReservation ? 201 : 200).json({ data: orderCheckoutData(order, plan) });
  } finally {
    await User.updateOne({ _id: req.user._id }, { $unset: { checkoutLockPlanId: 1, checkoutLockExpiresAt: 1 } });
  }
}));

app.post('/api/verify-payment', authRequired, asyncRoute(async (req, res) => {
  const parsed = z.object({ razorpay_order_id: z.string().min(1), razorpay_payment_id: z.string().min(1), razorpay_signature: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Order ID, payment ID, and signature are required.' });
  const input = parsed.data;
  const orderId = input.razorpay_order_id;
  const paymentId = input.razorpay_payment_id;
  const membership = await Membership.findOne({ user: req.user._id, razorpayOrderId: orderId });
  if (!membership) return res.status(404).json({ error: 'This order was not found for your account.' });
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return res.status(503).json({ error: 'Razorpay is not configured on the server.' });

  const expected = createHmac('sha256', secret).update(orderId + '|' + paymentId).digest();
  let received;
  try { received = Buffer.from(input.razorpay_signature, 'hex'); } catch { received = Buffer.alloc(0); }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return res.status(400).json({ error: 'Razorpay could not verify this payment. The membership was not activated.' });
  }

  const [payment, order] = await Promise.all([
    fetchRazorpayPayment(paymentId),
    fetchRazorpayOrder(orderId),
  ]);
  const plan = findPlan(membership.planId);
  const expectedAmount = Math.round(Number(plan?.price || 0) * 100);
  const expectedCurrency = String(plan?.currency || 'INR').toUpperCase();
  if (payment.order_id !== orderId || order.id !== orderId || payment.amount !== expectedAmount || order.amount !== expectedAmount || String(payment.currency).toUpperCase() !== expectedCurrency || String(order.currency).toUpperCase() !== expectedCurrency) {
    return res.status(400).json({ error: 'The payment details do not match this membership order.' });
  }
  if (payment.status !== 'captured') {
    return res.status(409).json({ error: 'Payment is not captured yet. The membership has not been activated.' });
  }

  const activation = await recordCapturedOrderPayment(membership, payment);
  if (activation.duplicate) return res.status(409).json({ error: 'This order already has a captured payment. Your membership was not extended twice; contact the club if you see another charge.' });
  const updatedMembership = await Membership.findById(membership._id);
  return res.json({ data: { membership: updatedMembership } });
}));

app.post('/api/payments/cancel-membership', authRequired, asyncRoute(async (req, res) => {
  const membership = await Membership.findOne({ user: req.user._id, status: { $in: ['active', 'trialing', 'past_due'] } }).sort({ createdAt: -1 });
  if (!membership) return res.status(404).json({ error: 'No active membership found.' });
  if (!membership.razorpaySubscriptionId || !isRazorpayConfigured()) return res.status(503).json({ error: 'This membership does not have an auto-renewing subscription to cancel.' });
  const subscription = await cancelRazorpaySubscription(membership.razorpaySubscriptionId, true);
  membership.cancelAtPeriodEnd = true;
  if (subscription.current_end) membership.currentPeriodEnd = new Date(subscription.current_end * 1000);
  await membership.save();
  await notify(req.user._id, 'Membership ending', 'Your access stays active through your current billing period.', 'billing', 'subscription-cancel-scheduled:' + membership.razorpaySubscriptionId + ':' + (membership.currentPeriodEnd?.getTime() || 'unknown'));
  return res.json({ data: { membership } });
}));

app.post('/api/payments/resume-membership', authRequired, asyncRoute(async (req, res) => {
  const membership = await Membership.findOne({ user: req.user._id, status: { $in: ['active', 'trialing'] }, cancelAtPeriodEnd: true }).sort({ createdAt: -1 });
  if (!membership?.razorpaySubscriptionId || !isRazorpayConfigured()) return res.status(404).json({ error: 'No scheduled subscription cancellation was found.' });
  await resumeRazorpaySubscriptionRenewal(membership.razorpaySubscriptionId);
  membership.cancelAtPeriodEnd = false;
  await membership.save();
  await notify(req.user._id, 'Auto-renew restored', 'Your membership will renew at the end of its current billing period.', 'billing');
  return res.json({ data: { membership } });
}));

app.use('/api/admin', authRequired, adminRequired, adminRouter);

const staticDir = path.resolve(here, '../client/dist');
app.use(express.static(staticDir, { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
app.get(/.*/, (req, res, next) => {
  if (req.path === '/api' || req.path.startsWith('/api/')) return next();
  return res.sendFile(path.join(staticDir, 'index.html'), (error) => error && next(error));
});
app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
app.use(handleError);

try {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
} catch (error) {
  console.error('Could not connect to MongoDB. Check MONGODB_URI and confirm the database is running or reachable.', error.message);
  process.exit(1);
}
await seedDefaults();
await migrateSessionReservations();
await repairSessionReservations();
const recoveryTimer = setInterval(() => {
  repairSessionReservations().catch((error) => console.error('Booking recovery failed:', error.message));
  retryStoredWebhooks().catch((error) => console.error('Webhook recovery failed:', error.message));
}, 15000);
recoveryTimer.unref();
app.listen(PORT, () => console.info('Northstar API listening on port ' + PORT));

import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['member', 'admin'], default: 'member' },
  phone: { type: String, default: '', maxlength: 40 },
  goal: { type: String, default: '', maxlength: 160 },
  avatar: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  authVersion: { type: Number, default: 0 },
  passwordResetTokenHash: { type: String, select: false },
  passwordResetExpiresAt: { type: Date, select: false },
  checkoutLockPlanId: { type: String, select: false },
  checkoutLockExpiresAt: { type: Date, select: false },
}, { timestamps: true });

const membershipSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  planId: { type: String, required: true },
  status: { type: String, enum: ['active', 'trialing', 'past_due', 'canceled', 'incomplete'], default: 'incomplete' },
  razorpayCustomerId: String,
  razorpaySubscriptionId: { type: String, index: true },
  razorpayOrderId: { type: String, unique: true, sparse: true },
  razorpayCapturedPaymentId: { type: String, unique: true, sparse: true },
  checkoutReceipt: { type: String, unique: true, sparse: true },
  currentPeriodEnd: Date,
  cancelAtPeriodEnd: { type: Boolean, default: false },
  checkoutStartedAt: Date,
  activatedOrderPaymentIds: { type: [String], default: [] },
  lastRazorpayEventAt: Date,
}, { timestamps: true });

const sessionSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 80 },
  category: { type: String, required: true, trim: true },
  coach: { type: String, required: true, trim: true },
  date: { type: Date, required: true, index: true },
  duration: { type: Number, default: 50, min: 15, max: 240 },
  capacity: { type: Number, default: 16, min: 1, max: 100 },
  seatsBooked: { type: Number, default: 0, min: 0 },
  reservedUserIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
  level: { type: String, enum: ['All levels', 'Beginner', 'Intermediate', 'Advanced'], default: 'All levels' },
  room: { type: String, default: 'Studio 01' },
  published: { type: Boolean, default: true },
}, { timestamps: true });

const bookingSchema = new mongoose.Schema({
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: ['booked', 'cancelled', 'attended'], default: 'booked' },
  cancelRequestedAt: Date,
}, { timestamps: true });
bookingSchema.index({ session: 1, user: 1 }, { unique: true });

const reviewSchema = new mongoose.Schema({
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  rating: { type: Number, min: 1, max: 5, required: true },
  comment: { type: String, trim: true, maxlength: 800, default: '' },
}, { timestamps: true });
reviewSchema.index({ session: 1, user: 1 }, { unique: true });

const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: { type: String, enum: ['info', 'success', 'class', 'billing'], default: 'info' },
  readAt: Date,
  dedupeKey: { type: String, unique: true, sparse: true },
}, { timestamps: true });

const paymentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  razorpayPaymentId: { type: String, unique: true, sparse: true },
  razorpayOrderId: { type: String, index: true },
  razorpaySubscriptionId: { type: String, index: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'usd' },
  status: { type: String, enum: ['paid', 'pending', 'refunded', 'failed'], default: 'paid' },
  description: { type: String, default: 'Membership payment' },
}, { timestamps: true });

const gatewayPlanSchema = new mongoose.Schema({
  planId: { type: String, required: true },
  currency: { type: String, required: true },
  amount: { type: Number, required: true },
  mode: { type: String, enum: ['test', 'live'], required: true },
  razorpayPlanId: { type: String, required: true, unique: true },
}, { timestamps: true });
gatewayPlanSchema.index({ planId: 1, currency: 1, amount: 1, mode: 1 }, { unique: true });

const webhookEventSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true },
  event: { type: String, required: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, enum: ['pending', 'processing', 'failed', 'processed'], default: 'pending', index: true },
  attempts: { type: Number, default: 0 },
  leaseExpiresAt: Date,
  lastError: { type: String, maxlength: 500 },
  processedAt: Date,
}, { timestamps: true });
webhookEventSchema.index({ status: 1, leaseExpiresAt: 1 });

export const User = mongoose.model('User', userSchema);
export const Membership = mongoose.model('Membership', membershipSchema);
export const Session = mongoose.model('Session', sessionSchema);
export const Booking = mongoose.model('Booking', bookingSchema);
export const Review = mongoose.model('Review', reviewSchema);
export const Notification = mongoose.model('Notification', notificationSchema);
export const Payment = mongoose.model('Payment', paymentSchema);
export const GatewayPlan = mongoose.model('GatewayPlan', gatewayPlanSchema);
export const WebhookEvent = mongoose.model('WebhookEvent', webhookEventSchema);

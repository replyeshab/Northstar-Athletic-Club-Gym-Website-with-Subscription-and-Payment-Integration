import { Router } from 'express';
import { z } from 'zod';
import { User, Membership, Session, Booking, Review, Payment } from '../models/index.js';
import { findPlan } from '../config/plans.js';
import { notify } from '../lib/services.js';
import { materializeBooking, releaseClassSpot, reserveClassSpot } from '../lib/bookings.js';

const router = Router();

router.get('/overview', async (req, res) => {
  const [members, activeMembers, upcomingClasses, bookings, reviews, revenue] = await Promise.all([
    User.countDocuments({ role: 'member' }),
    Membership.countDocuments({ status: { $in: ['active', 'trialing'] } }),
    Session.countDocuments({ date: { $gte: new Date() }, published: true }),
    Booking.countDocuments({ status: 'booked' }),
    Review.countDocuments(),
    Payment.aggregate([{ $match: { status: 'paid' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
  ]);
  const latestMembers = await User.find({ role: 'member' }).select('name email createdAt disabled').sort({ createdAt: -1 }).limit(8).lean();
  const latestPayments = await Payment.find().populate('user', 'name email').sort({ createdAt: -1 }).limit(8).lean();
  return res.json({ data: { members, activeMembers, upcomingClasses, bookings, reviews, revenue: revenue[0]?.total || 0, latestMembers, latestPayments } });
});

router.get('/members', async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const search = String(req.query.q || '').trim();
  const filter = { role: 'member', ...(search ? { $or: [{ name: new RegExp(escapeRegex(search), 'i') }, { email: new RegExp(escapeRegex(search), 'i') }] } : {}) };
  const [items, total] = await Promise.all([
    User.find(filter).select('name email phone goal createdAt disabled').sort({ createdAt: -1 }).skip((page - 1) * 50).limit(50).lean(),
    User.countDocuments(filter),
  ]);
  return res.json({ data: items, page, total });
});

router.patch('/members/:id', async (req, res) => {
  const input = z.object({ disabled: z.boolean() }).strict().parse(req.body);
  const user = await User.findOneAndUpdate({ _id: req.params.id, role: 'member' }, { $set: input }, { new: true }).select('name email disabled');
  if (!user) return res.status(404).json({ error: 'Member not found.' });
  await notify(user._id, input.disabled ? 'Account paused' : 'Account restored', input.disabled ? 'Your account access has been paused. Contact the club team if you need help.' : 'Your account access has been restored.', 'info');
  return res.json({ data: user });
});

router.get('/classes', async (req, res) => {
  const items = await Session.find({ date: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }).sort({ date: 1 }).limit(200).lean();
  const counts = await Booking.aggregate([{ $match: { session: { $in: items.map((item) => item._id) }, status: 'booked' } }, { $group: { _id: '$session', count: { $sum: 1 } } }]);
  const map = new Map(counts.map((item) => [String(item._id), item.count]));
  return res.json({ data: items.map((item) => ({ ...item, seatsBooked: map.get(String(item._id)) || 0 })) });
});

const classSchema = z.object({
  title: z.string().trim().min(2).max(80),
  category: z.string().trim().min(2).max(40),
  coach: z.string().trim().min(2).max(80),
  date: z.coerce.date(),
  duration: z.number().int().min(15).max(240).default(50),
  capacity: z.number().int().min(1).max(100).default(16),
  level: z.enum(['All levels', 'Beginner', 'Intermediate', 'Advanced']).default('All levels'),
  room: z.string().trim().min(2).max(60).default('Studio 01'),
  published: z.boolean().default(true),
});
router.post('/classes', async (req, res) => {
  const input = classSchema.parse(req.body);
  if (input.date <= new Date()) return res.status(400).json({ error: 'Choose a future class time.' });
  const item = await Session.create(input);
  return res.status(201).json({ data: item });
});

router.patch('/classes/:id', async (req, res) => {
  const input = classSchema.partial().strict().parse(req.body);
  const item = await Session.findByIdAndUpdate(req.params.id, { $set: input }, { new: true, runValidators: true });
  if (!item) return res.status(404).json({ error: 'Class not found.' });
  const affected = await Booking.find({ session: item._id, status: 'booked' }).select('user');
  await Promise.all(affected.map(({ user }) => notify(user, 'Class details changed', item.title + ' has been updated. Check your schedule for the latest details.', 'class')));
  return res.json({ data: item });
});

router.delete('/classes/:id', async (req, res) => {
  const item = await Session.findById(req.params.id);
  if (!item) return res.status(404).json({ error: 'Class not found.' });
  const booked = await Booking.find({ session: item._id, status: 'booked' }).select('user');
  await Promise.all(booked.map(({ user }) => notify(user, 'Class cancelled', item.title + ' has been cancelled by the club. Please choose another time.', 'class')));
  await Booking.updateMany({ session: item._id, status: 'booked' }, { $set: { status: 'cancelled' } });
  await Session.deleteOne({ _id: item._id });
  return res.json({ data: { success: true } });
});

router.get('/bookings', async (req, res) => {
  const items = await Booking.find().populate('user', 'name email').populate('session', 'title category date coach').sort({ createdAt: -1 }).limit(250).lean();
  return res.json({ data: items });
});

router.patch('/bookings/:id/attendance', async (req, res) => {
  const input = z.object({ status: z.enum(['attended', 'booked', 'cancelled']) }).strict().parse(req.body);
  const current = await Booking.findById(req.params.id);
  if (!current) return res.status(404).json({ error: 'Booking not found.' });

  if (input.status === 'cancelled' && current.status !== 'cancelled') {
    await Booking.updateOne({ _id: current._id }, { $set: { cancelRequestedAt: new Date() } });
    await releaseClassSpot(current.session, current.user);
    await Booking.updateOne({ _id: current._id }, { $set: { status: 'cancelled' }, $unset: { cancelRequestedAt: 1 } });
  } else if (input.status === 'booked' && current.status !== 'booked') {
    const reservation = await reserveClassSpot(current.session, current.user);
    if (!reservation.reserved) return res.status(409).json({ error: 'There are no seats left in this class.' });
    await materializeBooking(current.session, current.user);
  } else {
    await Booking.updateOne({ _id: current._id }, { $set: { status: input.status } });
  }

  const booking = await Booking.findById(current._id).populate('user', 'name email').populate('session', 'title');
  return res.json({ data: booking });
});

router.get('/reviews', async (req, res) => {
  const items = await Review.find().populate('user', 'name email').populate('session', 'title date').sort({ createdAt: -1 }).limit(200).lean();
  return res.json({ data: items });
});
router.delete('/reviews/:id', async (req, res) => {
  const item = await Review.findByIdAndDelete(req.params.id);
  if (!item) return res.status(404).json({ error: 'Review not found.' });
  return res.json({ data: { success: true } });
});

router.get('/payments', async (req, res) => {
  const items = await Payment.find().populate('user', 'name email').sort({ createdAt: -1 }).limit(250).lean();
  return res.json({ data: items });
});

router.get('/memberships', async (req, res) => {
  const items = await Membership.find().populate('user', 'name email').sort({ createdAt: -1 }).limit(250).lean();
  return res.json({ data: items.map((item) => ({ ...item, plan: findPlan(item.planId) })) });
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default router;

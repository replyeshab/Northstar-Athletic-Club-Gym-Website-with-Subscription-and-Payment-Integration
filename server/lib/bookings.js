import { Booking, Session } from '../models/index.js';
import { notify } from './services.js';

const duplicateKey = (error) => error?.code === 11000;

export async function reserveClassSpot(sessionId, userId, now = new Date(), SessionModel = Session) {
  const session = await SessionModel.findOneAndUpdate(
    {
      _id: sessionId,
      published: true,
      date: { $gt: now },
      reservedUserIds: { $ne: userId },
      $expr: { $lt: ['$seatsBooked', '$capacity'] },
    },
    { $addToSet: { reservedUserIds: userId }, $inc: { seatsBooked: 1 } },
    { new: true },
  );
  if (session) return { reserved: true, session };

  const existing = await SessionModel.findOne({ _id: sessionId, reservedUserIds: userId });
  if (existing) return { reserved: true, alreadyReserved: true, session: existing };
  return { reserved: false, session: null };
}

export async function releaseClassSpot(sessionId, userId, SessionModel = Session) {
  return SessionModel.updateOne(
    { _id: sessionId, reservedUserIds: userId },
    [{ $set: {
      reservedUserIds: { $filter: { input: { $ifNull: ['$reservedUserIds', []] }, as: 'reservedUserId', cond: { $ne: ['$$reservedUserId', userId] } } },
      seatsBooked: { $max: [0, { $subtract: ['$seatsBooked', 1] }] },
    } }],
  );
}

export async function materializeBooking(sessionId, userId, BookingModel = Booking) {
  try {
    return await BookingModel.findOneAndUpdate(
      { session: sessionId, user: userId, cancelRequestedAt: { $exists: false } },
      { $set: { status: 'booked' }, $unset: { cancelRequestedAt: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
    );
  } catch (error) {
    if (!duplicateKey(error)) throw error;
    return BookingModel.findOne({ session: sessionId, user: userId });
  }
}

export async function completeBookingCancellation(booking, { SessionModel = Session, BookingModel = Booking } = {}) {
  if (!booking?.session || !booking?.user) return;
  const sessionId = booking.session._id || booking.session;
  const userId = booking.user._id || booking.user;
  await releaseClassSpot(sessionId, userId, SessionModel);
  await BookingModel.updateOne(
    { _id: booking._id },
    { $set: { status: 'cancelled' }, $unset: { cancelRequestedAt: 1 } },
  );
}

export async function repairSessionReservations({ SessionModel = Session, BookingModel = Booking, notifyFn = notify } = {}) {
  const cancellations = await BookingModel.find({ cancelRequestedAt: { $exists: true } }).select('_id session user');
  for (const booking of cancellations) await completeBookingCancellation(booking, { SessionModel, BookingModel });

  const sessions = await SessionModel.find({ reservedUserIds: { $exists: true, $ne: [] } }).select('_id title room reservedUserIds').lean();
  for (const session of sessions) {
    for (const userId of session.reservedUserIds) {
      const booking = await materializeBooking(session._id, userId, BookingModel);
      if (!booking || booking.status !== 'booked' || booking.cancelRequestedAt) continue;
      await notifyFn(userId, 'Class booked', 'You are booked for ' + session.title + '. See you in ' + session.room + '.', 'class', 'class-booked:' + session._id + ':' + userId);
    }
  }
  return { repairedSessions: sessions.length, completedCancellations: cancellations.length };
}

export async function migrateSessionReservations({ SessionModel = Session, BookingModel = Booking } = {}) {
  // Backfill only legacy records. Never overwrite a reservation marker on restart:
  // it may be the only durable trace of a booking interrupted before its Booking row was saved.
  const legacySessions = await SessionModel.find({ reservedUserIds: { $exists: false } }).select('_id').lean();
  for (const { _id } of legacySessions) {
    const users = await BookingModel.find({ session: _id, status: 'booked' }).distinct('user');
    await SessionModel.updateOne(
      { _id, reservedUserIds: { $exists: false } },
      { $set: { reservedUserIds: users, seatsBooked: users.length } },
    );
  }
}

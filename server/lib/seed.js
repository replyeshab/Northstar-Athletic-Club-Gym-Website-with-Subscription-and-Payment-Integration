import bcrypt from 'bcryptjs';
import { User, Session } from '../models/index.js';

export async function seedDefaults() {
  const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase().trim();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    const existing = await User.findOne({ email: adminEmail });
    if (!existing) {
      const passwordHash = await bcrypt.hash(adminPassword, 12);
      await User.create({ name: process.env.ADMIN_NAME || 'Club Admin', email: adminEmail, passwordHash, role: 'admin' });
      console.info('Created initial admin account for ' + adminEmail);
    } else if (existing.role !== 'admin') {
      await User.updateOne({ _id: existing._id }, { $set: { role: 'admin' } });
    }
  }

  if (await Session.estimatedDocumentCount()) return;
  const templates = [
    ['Strength foundations', 'Strength', 'Maya Chen', 7, 'Beginner', 'Iron room'],
    ['Power hour', 'Strength', 'Jordan Reed', 9, 'Intermediate', 'Iron room'],
    ['Slow flow', 'Mobility', 'Nina Patel', 11, 'All levels', 'Studio 02'],
    ['Tempo ride', 'Ride', 'Leo Brooks', 17, 'All levels', 'Cycle studio'],
    ['Athletic conditioning', 'Conditioning', 'Maya Chen', 18, 'Advanced', 'Turf room'],
    ['Reset + restore', 'Mobility', 'Nina Patel', 19, 'All levels', 'Studio 02'],
  ];
  const now = new Date();
  const sessions = [];
  for (let day = 0; day < 8; day += 1) {
    for (const [title, category, coach, hour, level, room] of templates) {
      if (day === 0 && hour < now.getHours() + 1) continue;
      const date = new Date(now);
      date.setDate(date.getDate() + day);
      date.setHours(hour, day % 2 ? 30 : 0, 0, 0);
      sessions.push({ title, category, coach, date, duration: category === 'Ride' ? 45 : 50, capacity: category === 'Mobility' ? 18 : 16, level, room });
    }
  }
  await Session.insertMany(sessions);
}

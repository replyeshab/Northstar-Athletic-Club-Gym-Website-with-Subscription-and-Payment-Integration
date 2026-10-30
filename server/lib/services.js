import nodemailer from 'nodemailer';
import { Notification } from '../models/index.js';

export async function notify(userId, title, message, type = 'info', dedupeKey) {
  const fields = { user: userId, title, message, type };
  if (!dedupeKey) return Notification.create(fields);
  try {
    return await Notification.findOneAndUpdate(
      { dedupeKey },
      { $setOnInsert: { ...fields, dedupeKey } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
    return Notification.findOne({ dedupeKey });
  }
}

export async function sendWelcomeEmail(user) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.info('[email:disabled] Welcome email queued for ' + user.email + '. Configure SMTP_HOST, SMTP_USER, and SMTP_PASS to deliver it.');
    return false;
  }
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: Number(SMTP_PORT || 587) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  const firstName = escapeHtml(user.name.split(' ')[0]);
  await transport.sendMail({
    from: EMAIL_FROM || SMTP_USER,
    to: user.email,
    subject: 'Welcome to Northstar',
    text: 'Hey ' + user.name.split(' ')[0] + ', welcome to Northstar Athletic Club. Your next strong day starts here. Sign in to book your first class.',
    html: '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#20231f"><p style="letter-spacing:.18em;text-transform:uppercase;font-size:12px;color:#7b855c">NORTHSTAR ATHLETIC CLUB</p><h1 style="font-size:32px">Your next strong day starts here.</h1><p>Hey ' + firstName + ', welcome to the club. We are glad you are here. Sign in to explore the schedule and find your first class.</p><p>Show up as you are. We will take it from there.</p></div>',
  });
  return true;
}

export async function sendPasswordResetEmail(user, resetUrl) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.info('[email:disabled] Password reset email could not be delivered for ' + user.email + '. Configure SMTP to enable password recovery.');
    return false;
  }
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: Number(SMTP_PORT || 587) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  const firstName = escapeHtml(user.name.split(' ')[0]);
  const safeUrl = escapeHtml(resetUrl);
  await transport.sendMail({
    from: EMAIL_FROM || SMTP_USER,
    to: user.email,
    subject: 'Reset your Northstar password',
    text: 'Hi ' + user.name.split(' ')[0] + ', use this link to reset your password. It expires in 30 minutes: ' + resetUrl,
    html: '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#20231f"><p style="letter-spacing:.18em;text-transform:uppercase;font-size:12px;color:#7b855c">NORTHSTAR ATHLETIC CLUB</p><h1 style="font-size:30px">Reset your password</h1><p>Hi ' + firstName + ', use this secure link to choose a new password. It expires in 30 minutes.</p><p><a href="' + safeUrl + '" style="display:inline-block;padding:13px 20px;background:#293127;color:#fff;text-decoration:none">Choose a new password</a></p><p>If you did not request this, you can ignore this email.</p></div>',
  });
  return true;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

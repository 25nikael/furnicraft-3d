'use strict';

/**
 * OTP email sender.
 *
 * If SMTP_USER is configured, codes are emailed via nodemailer.
 * Otherwise the server runs in DEV mode: the code is NOT emailed and is
 * instead returned to the client so it can be shown in the UI. This keeps
 * local development frictionless without SMTP credentials.
 */

const nodemailer = require('nodemailer');

let transporter = null;

function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
  }
  return transporter;
}

/**
 * Send a verification code.
 * @returns {Promise<{devMode: boolean}>} devMode true when no SMTP configured.
 */
async function sendOTP(email, code) {
  if (!smtpConfigured()) {
    console.log(`[email] DEV MODE — OTP for ${email} is ${code}`);
    return { devMode: true };
  }
  const from = process.env.SMTP_FROM || 'FurniCraft 3D <no-reply@furnicraft.app>';
  await getTransporter().sendMail({
    from,
    to: email,
    subject: 'Your FurniCraft 3D verification code',
    text: `Your verification code is ${code}. It expires in 10 minutes.`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:420px;margin:0 auto;padding:24px;">
        <h2 style="color:#0ABAB5;margin:0 0 12px;">FurniCraft 3D</h2>
        <p style="color:#333;font-size:15px;">Your verification code is:</p>
        <div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#111;
                    background:#f4f4f0;border-radius:8px;padding:16px;text-align:center;margin:16px 0;">
          ${code}
        </div>
        <p style="color:#888;font-size:13px;">This code expires in 10 minutes. If you didn't
        request it, you can safely ignore this email.</p>
      </div>`
  });
  return { devMode: false };
}

module.exports = { sendOTP, smtpConfigured };

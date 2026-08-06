/**
 * Email Service — nodemailer-based transactional email.
 *
 * Configuration is fully environment-variable driven:
 *   EMAIL_HOST     — SMTP host (e.g. smtp.gmail.com, smtp.sendgrid.net)
 *   EMAIL_PORT     — SMTP port (default 587)
 *   EMAIL_SECURE   — "true" for port 465 TLS, leave unset for STARTTLS
 *   EMAIL_USER     — SMTP username / API key username
 *   EMAIL_PASS     — SMTP password / API key
 *   EMAIL_FROM     — From address (e.g. "BitZimi <noreply@bitzimi.com>")
 *   FRONTEND_URL   — Used to build links in email bodies
 *
 * When EMAIL_HOST is not set the service falls back to console output
 * (development mode) without throwing, so local development needs no SMTP.
 */
import nodemailer, { Transporter } from "nodemailer";

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (transporter) return transporter;

  const host = process.env.EMAIL_HOST;
  if (!host) return null; // development fallback — no SMTP configured

  transporter = nodemailer.createTransport({
    host,
    port:   parseInt(process.env.EMAIL_PORT ?? "587", 10),
    secure: process.env.EMAIL_SECURE === "true",
    auth: {
      user: process.env.EMAIL_USER ?? "",
      pass: process.env.EMAIL_PASS ?? "",
    },
    tls: { rejectUnauthorized: process.env.NODE_ENV === "production" },
  });

  return transporter;
}

const FROM_ADDRESS = () =>
  process.env.EMAIL_FROM ?? "BitZimi <noreply@bitzimi.com>";

const FRONTEND_URL = () =>
  process.env.FRONTEND_URL ?? "http://localhost:5173";

// ── Internal send helper ──────────────────────────────────────────────────────

async function send(to: string, subject: string, html: string): Promise<void> {
  const t = getTransporter();

  if (!t) {
    // No SMTP configured — log to console for local development only
    if (process.env.NODE_ENV !== "production") {
      console.log(`[Email] To: ${to} | Subject: ${subject}`);
      // HTML preview stripped to plaintext for readability
      console.log(`[Email] Body: ${html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}`);
    }
    return;
  }

  await t.sendMail({ from: FROM_ADDRESS(), to, subject, html });
}

// ── Email templates ───────────────────────────────────────────────────────────

function baseTemplate(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BitZimi</title>
<style>
  body { margin:0; padding:0; background:#0f0f11; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:#e4e4e7; }
  .wrap { max-width:520px; margin:40px auto; padding:0 16px; }
  .card { background:#18181b; border:1px solid rgba(255,255,255,0.07); border-radius:16px; padding:36px 32px; }
  .logo { font-size:22px; font-weight:800; color:#fff; letter-spacing:-0.5px; margin-bottom:28px; }
  .logo span { color:#6366f1; }
  h2 { margin:0 0 12px; font-size:18px; font-weight:700; color:#fff; }
  p { margin:0 0 16px; font-size:14px; line-height:1.6; color:#a1a1aa; }
  .btn { display:inline-block; background:#6366f1; color:#fff; text-decoration:none; padding:12px 28px; border-radius:10px; font-size:14px; font-weight:600; margin:8px 0 20px; }
  .token { background:#09090b; border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:12px 16px; font-family:monospace; font-size:13px; color:#a5b4fc; word-break:break-all; margin:12px 0; }
  .footer { margin-top:24px; font-size:12px; color:#52525b; text-align:center; }
  .divider { height:1px; background:rgba(255,255,255,0.06); margin:24px 0; }
</style>
</head>
<body><div class="wrap"><div class="card">
<div class="logo">Bit<span>Zimi</span></div>
${content}
<div class="divider"></div>
<p class="footer">BitZimi — This email was sent automatically. Do not reply to this message.</p>
</div></div></body></html>`;
}

// ── Public email functions ────────────────────────────────────────────────────

export async function sendPasswordResetEmail(
  to: string,
  rawToken: string
): Promise<void> {
  const link = `${FRONTEND_URL()}/reset-password?token=${rawToken}`;
  const html = baseTemplate(`
    <h2>Reset your password</h2>
    <p>We received a request to reset the password for your BitZimi account associated with this email address.</p>
    <p>Click the button below to set a new password. This link expires in <strong>1 hour</strong>.</p>
    <a href="${link}" class="btn">Reset Password</a>
    <p>If the button doesn't work, copy and paste this link into your browser:</p>
    <div class="token">${link}</div>
    <p>If you did not request a password reset, you can safely ignore this email. Your password will not change.</p>
  `);
  await send(to, "Reset your BitZimi password", html);
}

export async function sendEmailVerificationEmail(
  to: string,
  rawToken: string
): Promise<void> {
  const link = `${FRONTEND_URL()}/verify-email?token=${rawToken}`;
  const html = baseTemplate(`
    <h2>Verify your email address</h2>
    <p>Thanks for signing up for BitZimi! Please verify your email address to activate your account.</p>
    <p>Click the button below. This link expires in <strong>24 hours</strong>.</p>
    <a href="${link}" class="btn">Verify Email Address</a>
    <p>Or copy and paste this link into your browser:</p>
    <div class="token">${link}</div>
    <p>If you did not create a BitZimi account, you can safely ignore this email.</p>
  `);
  await send(to, "Verify your BitZimi email address", html);
}

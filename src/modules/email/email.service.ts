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
  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="x-apple-disable-message-reformatting">
  <title>Verify your BitZimi email address</title>
  <!--[if mso]>
  <xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch><o:AllowPNG/></o:OfficeDocumentSettings></xml>
  <![endif]-->
  <style>
    body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
    img { -ms-interpolation-mode:bicubic; border:0; }
    @media only screen and (max-width:620px) {
      .email-wrapper { padding:24px 12px 32px !important; }
      .card-body     { padding:32px 24px 28px !important; }
      .card-footer   { padding:16px 24px 20px !important; }
      .email-heading { font-size:22px !important; line-height:1.25 !important; }
      .btn-fallback  { font-size:10px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#08091a;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">

<!-- Outer wrapper -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#08091a" style="background-color:#08091a;min-width:100%;">
  <tr>
    <td align="center" class="email-wrapper" style="padding:48px 16px 40px;">

      <!-- Card container -->
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;">

        <!-- Top accent bar -->
        <tr>
          <td height="3" bgcolor="#6366f1" style="background-color:#6366f1;border-radius:20px 20px 0 0;font-size:0;line-height:0;mso-line-height-rule:exactly;">&nbsp;</td>
        </tr>

        <!-- Card body -->
        <tr>
          <td class="card-body" bgcolor="#0f1023" style="background-color:#0f1023;border-left:1px solid #1c1e42;border-right:1px solid #1c1e42;padding:44px 48px 36px;">

            <!-- Logo -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:36px;">
              <tr>
                <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:22px;font-weight:800;letter-spacing:-0.5px;color:#ffffff;mso-line-height-rule:exactly;">
                  Bit<span style="color:#818cf8;">Zimi</span>
                </td>
              </tr>
            </table>

            <!-- Icon badge -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
              <tr>
                <td width="60" height="60" align="center" valign="middle" bgcolor="#141630" style="background-color:#141630;border-radius:14px;border:1px solid #2a2d5e;width:60px;height:60px;text-align:center;vertical-align:middle;font-size:26px;line-height:60px;mso-line-height-rule:exactly;">
                  &#9993;
                </td>
              </tr>
            </table>

            <!-- Heading -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:16px;">
              <tr>
                <td>
                  <h1 class="email-heading" style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:26px;font-weight:700;line-height:1.2;color:#f2f2f8;letter-spacing:-0.3px;">
                    Verify your email address
                  </h1>
                </td>
              </tr>
            </table>

            <!-- Body copy -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:8px;">
              <tr>
                <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.7;color:#8486ab;">
                  Welcome to BitZimi! You&rsquo;re one step away from accessing the full platform. Please verify your email address to activate your account.
                </td>
              </tr>
            </table>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:32px;">
              <tr>
                <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.7;color:#8486ab;">
                  Click the button below to confirm your address. This link expires in <strong style="color:#c4c6e8;font-weight:600;">24&nbsp;hours</strong>.
                </td>
              </tr>
            </table>

            <!-- CTA button -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
              <tr>
                <td align="center" bgcolor="#6366f1" style="background-color:#6366f1;border-radius:12px;mso-padding-alt:0;">
                  <!--[if mso]>
                  <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${link}" style="height:52px;v-text-anchor:middle;width:248px;" arcsize="12%" stroke="f" fillcolor="#6366f1">
                  <w:anchorlock/>
                  <center style="color:#ffffff;font-family:sans-serif;font-size:15px;font-weight:700;letter-spacing:0.3px;">Verify Email Address</center>
                  </v:roundrect>
                  <![endif]-->
                  <!--[if !mso]><!-->
                  <a href="${link}" target="_blank"
                     style="display:inline-block;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;letter-spacing:0.3px;text-decoration:none;padding:16px 36px;border-radius:12px;background-color:#6366f1;mso-hide:all;">
                    Verify Email Address
                  </a>
                  <!--<![endif]-->
                </td>
              </tr>
            </table>

            <!-- Thin rule -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px;">
              <tr>
                <td height="1" bgcolor="#1c1e3a" style="background-color:#1c1e3a;font-size:0;line-height:0;mso-line-height-rule:exactly;">&nbsp;</td>
              </tr>
            </table>

            <!-- Fallback URL label -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:6px;">
              <tr>
                <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#4e5075;">
                  If the button doesn&rsquo;t work, copy and paste this URL into your browser:
                </td>
              </tr>
            </table>
            <!-- Fallback URL value -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:28px;">
              <tr>
                <td class="btn-fallback" bgcolor="#0b0c1e" style="background-color:#0b0c1e;border-radius:8px;border:1px solid #1c1e42;padding:10px 14px;font-family:'Courier New',Courier,monospace;font-size:11px;line-height:1.6;color:#6366f1;word-break:break-all;">
                  ${link}
                </td>
              </tr>
            </table>

            <!-- Ignore notice -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#4e5075;">
                  If you did not create a BitZimi account, you can safely ignore this email &mdash; no action is required.
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- Card footer -->
        <tr>
          <td class="card-footer" bgcolor="#080917" style="background-color:#080917;border:1px solid #1c1e42;border-top:none;border-radius:0 0 20px 20px;padding:18px 48px 22px;text-align:center;">
            <span style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#353759;">
              &copy; 2025 <strong style="color:#464870;font-weight:600;">BitZimi</strong> &nbsp;&bull;&nbsp; This email was sent automatically. Do not reply.
            </span>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>

</body>
</html>`;
  await send(to, "Verify your BitZimi email address", html);
}

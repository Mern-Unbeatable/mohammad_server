import fs from "node:fs";
import path from "node:path";
import type { MailMessage } from "@/infrastructure/mailer";

const BRAND = {
  primary: "#0876C4",
  deepBlue: "#0A1A44",
  tint: "#F0F6FC",
  pink: "#D81B70",
  orange: "#F7941D",
  green: "#5CB85C",
  text: "#344054",
  muted: "#667085",
  border: "#E4E7EC",
};

const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

const LOGO_CID = "labunity-logo";
// Same depth under src/ and dist/, so this resolves to server/assets in both.
const LOGO_PATH = path.resolve(__dirname, "../../../assets/email/logo.png");
const hasLogo = fs.existsSync(LOGO_PATH);

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatDuration = (minutes: number): string => {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
};

interface PasswordResetEmailInput {
  to: string;
  resetUrl: string;
  ttlMinutes: number;
  firstName?: string | null;
}

export const buildPasswordResetEmail = ({
  to,
  resetUrl,
  ttlMinutes,
  firstName,
}: PasswordResetEmailInput): MailMessage => {
  const duration = formatDuration(ttlMinutes);
  const greeting = firstName?.trim() ? `Hi ${firstName.trim()},` : "Hi,";
  const safeUrl = escapeHtml(resetUrl);
  const year = new Date().getFullYear();

  const text = [
    greeting,
    "",
    "We received a request to reset the password for your Lab Unity account.",
    `Use the link below to choose a new password. It expires in ${duration} and can only be used once.`,
    "",
    resetUrl,
    "",
    "If you didn't request a password reset, you can ignore this email. Your password won't change.",
    "",
    "— The Lab Unity team",
  ].join("\n");

  const header = hasLogo
    ? `<img src="cid:${LOGO_CID}" width="72" height="69" alt="Lab Unity" style="display:block;border:0;outline:none;width:72px;height:auto;margin:0 auto;" />`
    : `<span style="font-size:22px;font-weight:700;color:${BRAND.deepBlue};">Lab Unity</span>`;

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>Reset your Lab Unity password</title>
  </head>
  <body style="margin:0;padding:0;background-color:${BRAND.tint};font-family:${FONT_STACK};color:${BRAND.text};-webkit-text-size-adjust:100%;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      Your Lab Unity password reset link. It expires in ${duration} and can only be used once.
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND.tint};">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(16,24,40,0.08);">
            <tr>
              <td style="padding:0;font-size:0;line-height:0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td width="25%" height="5" style="background-color:${BRAND.pink};height:5px;"></td>
                    <td width="25%" height="5" style="background-color:${BRAND.orange};height:5px;"></td>
                    <td width="25%" height="5" style="background-color:${BRAND.green};height:5px;"></td>
                    <td width="25%" height="5" style="background-color:${BRAND.primary};height:5px;"></td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:32px 40px 0;">${header}</td>
            </tr>
            <tr>
              <td style="padding:28px 40px 8px;">
                <h1 style="margin:0 0 20px;font-size:26px;line-height:1.3;font-weight:700;color:${BRAND.deepBlue};">Reset your password</h1>
                <p style="margin:0 0 12px;font-size:16px;line-height:1.6;color:${BRAND.text};">${escapeHtml(greeting)}</p>
                <p style="margin:0;font-size:16px;line-height:1.6;color:${BRAND.text};">
                  We received a request to reset the password for your Lab Unity account.
                  Click the button below to choose a new one.
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:28px 40px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center" bgcolor="${BRAND.primary}" style="border-radius:10px;background-color:${BRAND.primary};">
                      <a href="${safeUrl}" target="_blank" style="display:inline-block;padding:15px 36px;font-size:16px;font-weight:700;line-height:1;color:#ffffff;text-decoration:none;border-radius:10px;">Reset password</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 40px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND.tint};border-radius:10px;">
                  <tr>
                    <td style="padding:14px 18px;font-size:14px;line-height:1.5;color:${BRAND.deepBlue};">
                      This link expires in <strong>${duration}</strong> and can only be used once.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 40px 32px;">
                <p style="margin:0 0 6px;font-size:13px;line-height:1.6;color:${BRAND.muted};">
                  If the button doesn't work, copy and paste this link into your browser:
                </p>
                <p style="margin:0;font-size:13px;line-height:1.5;word-break:break-all;">
                  <a href="${safeUrl}" target="_blank" style="color:${BRAND.primary};text-decoration:underline;">${safeUrl}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 40px 32px;border-top:1px solid ${BRAND.border};">
                <p style="margin:0 0 4px;font-size:14px;line-height:1.6;font-weight:600;color:${BRAND.deepBlue};">Didn't request this?</p>
                <p style="margin:0;font-size:14px;line-height:1.6;color:${BRAND.muted};">
                  You can safely ignore this email. Your password won't change until you create a new one.
                </p>
              </td>
            </tr>
          </table>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
            <tr>
              <td align="center" style="padding:24px 16px 0;font-size:12px;line-height:1.6;color:${BRAND.muted};">
                This email was sent to ${escapeHtml(to)} because a password reset was requested for this account.<br />
                &copy; ${year} Lab Unity. All rights reserved.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return {
    to,
    subject: "Reset your Lab Unity password",
    text,
    html,
    attachments: hasLogo
      ? [{ filename: "lab-unity-logo.png", path: LOGO_PATH, cid: LOGO_CID }]
      : undefined,
  };
};

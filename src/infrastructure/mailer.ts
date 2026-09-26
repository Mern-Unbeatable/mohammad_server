import nodemailer, { Transporter } from "nodemailer";
import { env } from "@/config/env";
import { logger } from "@/config/logger";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

let transporter: Transporter | null = null;

const getTransporter = (): Transporter | null => {
  if (!env.smtp.host) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: env.smtp.user
        ? { user: env.smtp.user, pass: env.smtp.pass }
        : undefined,
    });
  }
  return transporter;
};

/**
 * Sends a transactional email. Without SMTP configuration the message is
 * logged instead (development) so flows like password reset stay testable.
 */
export const sendMail = async (message: MailMessage): Promise<void> => {
  const transport = getTransporter();

  if (!transport) {
    if (env.isProduction) {
      throw new Error("SMTP is not configured (SMTP_HOST is empty)");
    }
    logger.warn(
      { to: message.to, subject: message.subject, text: message.text },
      "SMTP not configured — email logged instead of sent",
    );
    return;
  }

  await transport.sendMail({ from: env.smtp.from, ...message });
};

import nodemailer, { SendMailOptions, Transporter } from "nodemailer";
import { env } from "@/config/env";
import { logger } from "@/config/logger";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Inline images are referenced from the HTML as `cid:<cid>`. */
  attachments?: SendMailOptions["attachments"];
}

let transporter: Transporter | null = null;

const getTransporter = (): Transporter | null => {
  // TODO: Add SMTP configuration validation
  if (!env.smtp.host) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      // Never send credentials over an unencrypted connection in production.
      requireTLS: env.isProduction && !env.smtp.secure,
      auth: env.smtp.user
        ? { user: env.smtp.user, pass: env.smtp.pass }
        : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transporter;
};

/**
 * Sends a transactional email. Without SMTP configuration (development only)
 * the message is skipped and only its recipient/subject are logged — bodies
 * can contain secrets such as password reset links.
 */
export const sendMail = async (message: MailMessage): Promise<void> => {
  const transport = getTransporter();

  if (!transport) {
    if (env.isProduction) {
      throw new Error("SMTP is not configured (SMTP_HOST is empty)");
    }
    logger.warn(
      { to: message.to, subject: message.subject },
      "SMTP not configured — email not sent",
    );
    return;
  }

  await transport.sendMail({ from: env.smtp.from, ...message });
};

/** Checks the SMTP connection and credentials once at startup; never throws. */
export const verifyMailer = async (): Promise<void> => {
  const transport = getTransporter();
  if (!transport) {
    const message =
      "SMTP is not configured (SMTP_HOST is empty); emails will not be sent";
    if (env.isProduction) logger.error(message);
    else logger.warn(message);
    return;
  }
  try {
    await transport.verify();
    logger.info(
      { host: env.smtp.host, port: env.smtp.port },
      "SMTP connection verified",
    );
  } catch (err) {
    const { code, responseCode } = (err ?? {}) as {
      code?: string;
      responseCode?: number;
    };
    logger.error(
      { host: env.smtp.host, port: env.smtp.port, code, responseCode },
      "SMTP verification failed; check SMTP_* settings",
    );
  }
};

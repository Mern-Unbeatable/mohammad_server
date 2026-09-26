/**
 * Standalone SMTP check using the same settings the API uses (server/.env).
 *
 *   npm run smtp:test                      verify connection + login only
 *   npm run smtp:test -- you@example.com   also send a test email
 *
 * Never prints the SMTP password.
 */
import nodemailer from "nodemailer";
import { env } from "../src/config/env";

const recipient = process.argv[2];

const main = async (): Promise<void> => {
  const { host, port, secure, user, pass, from } = env.smtp;

  console.log("SMTP settings");
  console.log(`  host:     ${host || "(missing)"}`);
  console.log(`  port:     ${port}`);
  console.log(`  secure:   ${secure} ${secure ? "(implicit TLS)" : "(STARTTLS)"}`);
  console.log(`  user:     ${user || "(missing)"}`);
  console.log(`  password: ${pass ? "set" : "(missing)"}`);
  console.log(`  from:     ${from}`);
  console.log();

  if (!host) {
    console.error("FAIL: SMTP_HOST is empty in server/.env");
    process.exitCode = 1;
    return;
  }

  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  console.log("Verifying connection and login...");
  await transport.verify();
  console.log("OK: connected and authenticated");

  if (!recipient) {
    console.log("\nTip: pass an email address to also send a test message.");
    return;
  }

  console.log(`\nSending test email to ${recipient}...`);
  const sentAt = new Date().toISOString();
  const info = await transport.sendMail({
    from,
    to: recipient,
    subject: "Lab Unity SMTP test",
    text: `This is a test email from the Lab Unity server.\n\nSent at ${sentAt}.`,
    html: `<p>This is a test email from the Lab Unity server.</p><p>Sent at ${sentAt}.</p>`,
  });
  console.log(`OK: accepted by server (messageId ${info.messageId})`);
  if (info.rejected.length > 0) {
    console.warn(`Rejected recipients: ${info.rejected.join(", ")}`);
    process.exitCode = 1;
  }
};

main().catch((err: unknown) => {
  const { code, responseCode, response, message } = (err ?? {}) as {
    code?: string;
    responseCode?: number;
    response?: string;
    message?: string;
  };
  console.error("FAIL:", message ?? err);
  if (code || responseCode) {
    console.error(`  code: ${code ?? "-"}  responseCode: ${responseCode ?? "-"}`);
  }
  if (response) console.error(`  server said: ${response}`);
  process.exitCode = 1;
});

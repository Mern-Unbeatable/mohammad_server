import { env } from "@/config/env";
import { sendMail } from "@/infrastructure/mailer";
import {
  INQUIRY_LABELS,
  type ContactMessageInput,
} from "./contact.validators";

/** Plain-text email to the contact inbox; replying goes straight to the sender. */
export const buildContactEmail = (input: ContactMessageInput) => {
  const inquiry = INQUIRY_LABELS[input.inquiryType];
  const lines = [
    `Name: ${input.fullName}`,
    `Email: ${input.email}`,
    `Phone: ${input.phone || "-"}`,
    `Company: ${input.company || "-"}`,
    `Inquiry type: ${inquiry}`,
    "",
    input.message,
  ];

  return {
    to: env.contactInbox,
    replyTo: input.email,
    subject: `[Contact] ${inquiry} inquiry from ${input.fullName}`,
    text: lines.join("\n"),
  };
};

export const contactService = {
  async send(input: ContactMessageInput) {
    await sendMail(buildContactEmail(input));
  },
};

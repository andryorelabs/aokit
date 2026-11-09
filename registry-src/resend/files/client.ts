import { Resend } from "resend";

export function createResendClient(apiKey: string): Resend {
  return new Resend(apiKey);
}

export async function sendEmail(
  client: Resend,
  message: { from: string; to: string | string[]; subject: string; html: string },
): Promise<string> {
  const { data, error } = await client.emails.send(message);
  if (error !== null || data === null) {
    throw new Error(`Resend failed to send the email: ${error?.message ?? "no response data"}`);
  }
  return data.id;
}

declare module "resend" {
  export class Resend {
    constructor(apiKey: string);
    emails: {
      send(message: {
        from: string;
        to: string | string[];
        subject: string;
        html?: string;
        text?: string;
      }): Promise<{ data: { id: string } | null; error: { message: string } | null }>;
    };
  }
}

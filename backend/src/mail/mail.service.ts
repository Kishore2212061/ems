import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { env } from '../config/env';
import { otpEmail } from './templates';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

type Sender = (msg: MailMessage) => Promise<void>;

/**
 * Provider-agnostic mail. EMAIL_PROVIDER=resend | smtp | console.
 * Sends are fire-and-forget from request handlers (never block an auth response on SMTP),
 * with a small retry so transient provider errors don't lose an OTP.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger('Mail');
  private send!: Sender;
  private readonly from = `${env.EMAIL_FROM_NAME} <${env.EMAIL_FROM_ADDRESS}>`;

  async onModuleInit() {
    this.send = await this.createSender();
    this.logger.log(`Email provider: ${env.EMAIL_PROVIDER}`);
  }

  private async createSender(): Promise<Sender> {
    switch (env.EMAIL_PROVIDER) {
      case 'resend': {
        const { Resend } = await import('resend');
        const client = new Resend(env.RESEND_API_KEY);
        return async (m) => {
          const { error } = await client.emails.send({ from: this.from, replyTo: env.EMAIL_REPLY_TO, ...m });
          if (error) throw new Error(`${error.name}: ${error.message}`);
        };
      }
      case 'smtp': {
        const nodemailer = await import('nodemailer');
        const transport = nodemailer.createTransport({
          pool: true, // reuse TLS connections instead of a handshake per mail
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          secure: env.SMTP_SECURE,
          auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
        });
        return async (m) => {
          await transport.sendMail({ from: this.from, replyTo: env.EMAIL_REPLY_TO, ...m });
        };
      }
      default:
        return async (m) => this.logger.warn(`[console mail] to=${m.to} subject="${m.subject}"\n${m.text}`);
    }
  }

  /** Fire-and-forget with 3 attempts (0s, 1s, 3s). */
  dispatch(msg: MailMessage): void {
    const run = async () => {
      for (const [i, delay] of [0, 1000, 3000].entries()) {
        if (delay) await new Promise((r) => setTimeout(r, delay));
        try {
          await this.send(msg);
          return;
        } catch (e) {
          this.logger.error(`Send to ${msg.to} failed (attempt ${i + 1}/3): ${(e as Error).message}`);
        }
      }
    };
    void run();
  }

  sendOtp(to: string, name: string, code: string, ttlMinutes: number) {
    this.dispatch({ to, ...otpEmail({ name, code, ttlMinutes }) });
  }
}

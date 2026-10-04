import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ClientSession } from 'mongoose';
import type { OtpPurpose } from '../auth/schemas/otp-code.schema';
import { env } from '../config/env';
import { JobsService } from '../jobs/jobs.service';
import { otpEmail } from './templates';

/** An image shown inside the email body via <img src="cid:…"> (works when remote images are blocked). */
export interface InlineImage {
  filename: string;
  /** base64 */
  content: string;
  contentType: string;
  cid: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  inline?: InlineImage[];
}

type Sender = (msg: MailMessage) => Promise<void>;

export const EMAIL_JOB = 'email.send';

/**
 * Provider-agnostic mail. EMAIL_PROVIDER=resend | smtp | console.
 *
 * Every email goes through the durable job queue: dispatch() persists the message before the API
 * responds, and a worker delivers it with retries — a restart or provider hiccup can't lose an OTP.
 * After delivery the stored payload is reduced to the recipient (the body may contain a code).
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger('Mail');
  private send!: Sender;
  private readonly from = `${env.EMAIL_FROM_NAME} <${env.EMAIL_FROM_ADDRESS}>`;

  constructor(private readonly jobs: JobsService) {
    jobs.register<MailMessage>(EMAIL_JOB, (m) => this.send(m), { sanitize: (m: MailMessage) => ({ to: m.to }) });
  }

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
          const { inline, ...msg } = m;
          const { error } = await client.emails.send({
            from: this.from,
            replyTo: env.EMAIL_REPLY_TO,
            ...msg,
            ...(inline?.length && { attachments: inline.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType, contentId: a.cid })) }),
          });
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
          const { inline, ...msg } = m;
          await transport.sendMail({
            from: this.from,
            replyTo: env.EMAIL_REPLY_TO,
            ...msg,
            ...(inline?.length && { attachments: inline.map((a) => ({ filename: a.filename, content: a.content, encoding: 'base64', contentType: a.contentType, cid: a.cid })) }),
          });
        };
      }
      default:
        return async (m) => this.logger.warn(`[console mail] to=${m.to} subject="${m.subject}"\n${m.text}`);
    }
  }

  /**
   * Durably queue an email (one indexed insert, ~2 ms). Delivery + retries happen in the worker.
   * Pass the caller's session to queue it inside a transaction: it's sent only if the change commits.
   */
  dispatch(msg: MailMessage, opts: { session?: ClientSession; idempotencyKey?: string } = {}): Promise<void> {
    return this.jobs.enqueue(EMAIL_JOB, msg, { maxAttempts: 6, session: opts.session, idempotencyKey: opts.idempotencyKey });
  }

  sendOtp(to: string, name: string, code: string, ttlMinutes: number, purpose: OtpPurpose) {
    return this.dispatch({ to, ...otpEmail({ name, code, ttlMinutes, purpose }) });
  }
}

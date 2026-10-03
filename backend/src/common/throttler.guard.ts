import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Campus networks put hundreds of students behind one NAT IP, so pure per-IP limits
 * would lock out a whole college during registration rush. Auth bodies carry an email,
 * so we key on IP + email there; everything else falls back to IP.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    return email ? `${req.ip}|${email}` : req.ip;
  }
}

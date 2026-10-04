import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

export class GatewayError extends Error {}

/** What the rest of the app needs from a payment gateway. Amounts are integer paise. */
export interface PaymentGateway {
  readonly name: 'razorpay' | 'mock';
  /** Public key the browser checkout needs. */
  readonly keyId: string;
  createOrder(o: { amountPaise: number; receipt: string; notes: Record<string, string> }): Promise<{ id: string }>;
  /** Checkout handler signature: HMAC-SHA256(order_id|payment_id, key secret). */
  verifyPayment(orderId: string, paymentId: string, signature: string): boolean;
  /** Webhook signature: HMAC-SHA256(raw body, webhook secret). */
  verifyWebhook(rawBody: Buffer | string, signature: string): boolean;
  refund(paymentId: string, amountPaise: number): Promise<{ id: string }>;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

const hmac = (secret: string, data: Buffer | string) => createHmac('sha256', secret).update(data).digest('hex');
/** Constant-time compare of two hex strings. */
function sameHex(a: string, b: string) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Razorpay over plain fetch (no SDK): 8 s timeout, one retry on network errors only. */
export class RazorpayGateway implements PaymentGateway {
  readonly name = 'razorpay' as const;
  private readonly auth: string;

  constructor(
    readonly keyId: string,
    private readonly keySecret: string,
    private readonly webhookSecret: string,
  ) {
    this.auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
  }

  private async call<T>(path: string, body: unknown, retry = true): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`https://api.razorpay.com/v1${path}`, {
        method: 'POST',
        headers: { authorization: this.auth, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
    } catch (e) {
      if (retry) return this.call(path, body, false);
      throw new GatewayError(`Razorpay unreachable: ${(e as Error).message}`);
    }
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new GatewayError(data?.error?.description ?? `Razorpay HTTP ${res.status}`);
    return data as T;
  }

  createOrder(o: { amountPaise: number; receipt: string; notes: Record<string, string> }) {
    return this.call<{ id: string }>('/orders', { amount: o.amountPaise, currency: 'INR', receipt: o.receipt, notes: o.notes });
  }

  verifyPayment(orderId: string, paymentId: string, signature: string) {
    return sameHex(hmac(this.keySecret, `${orderId}|${paymentId}`), signature);
  }

  verifyWebhook(rawBody: Buffer | string, signature: string) {
    // No webhook secret configured → webhooks are off. (An empty HMAC key would let anyone sign.)
    if (!this.webhookSecret) return false;
    return sameHex(hmac(this.webhookSecret, rawBody), signature);
  }

  refund(paymentId: string, amountPaise: number) {
    return this.call<{ id: string }>(`/payments/${encodeURIComponent(paymentId)}/refund`, { amount: amountPaise, speed: 'normal' }, false);
  }
}

/**
 * Simulated gateway for local development and tests (refused in production by the env check).
 * Same signatures as Razorpay with throwaway per-process secrets, so verify and webhook code paths
 * are exactly the real ones; `sign*` let the dev "test payment" screen and tests act as the gateway.
 */
export class MockGateway implements PaymentGateway {
  readonly name = 'mock' as const;
  readonly keyId = 'rzp_test_simulated';
  private readonly keySecret = randomBytes(24).toString('hex');
  private readonly webhookSecret = randomBytes(24).toString('hex');
  readonly refunds: { paymentId: string; amountPaise: number }[] = [];

  async createOrder() {
    return { id: `order_sim_${randomBytes(7).toString('hex')}` };
  }
  verifyPayment(orderId: string, paymentId: string, signature: string) {
    return sameHex(hmac(this.keySecret, `${orderId}|${paymentId}`), signature);
  }
  verifyWebhook(rawBody: Buffer | string, signature: string) {
    return sameHex(hmac(this.webhookSecret, rawBody), signature);
  }
  async refund(paymentId: string, amountPaise: number) {
    this.refunds.push({ paymentId, amountPaise });
    return { id: `rfnd_sim_${randomBytes(7).toString('hex')}` };
  }
  /** Act as the checkout: a payment id and its valid signature for an order. */
  pay(orderId: string) {
    const paymentId = `pay_sim_${randomBytes(7).toString('hex')}`;
    return { paymentId, signature: hmac(this.keySecret, `${orderId}|${paymentId}`) };
  }
  signWebhook(rawBody: string) {
    return hmac(this.webhookSecret, rawBody);
  }
}

/** razorpay when configured; otherwise the simulator outside production; otherwise none (payments off). */
export function createGateway(): PaymentGateway | null {
  const provider = env.PAYMENTS_PROVIDER ?? (env.RAZORPAY_KEY_ID ? 'razorpay' : env.NODE_ENV === 'production' ? null : 'mock');
  if (provider === 'razorpay') return new RazorpayGateway(env.RAZORPAY_KEY_ID!, env.RAZORPAY_KEY_SECRET!, env.RAZORPAY_WEBHOOK_SECRET ?? '');
  if (provider === 'mock') return new MockGateway();
  return null;
}

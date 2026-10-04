import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RazorpayGateway } from './gateway';

const sign = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('hex');

describe('RazorpayGateway signatures', () => {
  it('checkout: HMAC(order_id|payment_id, key secret), compared in constant time', () => {
    const gw = new RazorpayGateway('rzp_test_x', 'key-secret', 'hook-secret');
    expect(gw.verifyPayment('order_1', 'pay_1', sign('key-secret', 'order_1|pay_1'))).toBe(true);
    expect(gw.verifyPayment('order_1', 'pay_2', sign('key-secret', 'order_1|pay_1'))).toBe(false);
    expect(gw.verifyPayment('order_1', 'pay_1', 'short')).toBe(false);
  });

  it('webhooks: HMAC(raw body, webhook secret); with no secret configured every webhook is refused', () => {
    const body = '{"event":"payment.captured"}';
    expect(new RazorpayGateway('k', 's', 'hook-secret').verifyWebhook(body, sign('hook-secret', body))).toBe(true);
    const noHook = new RazorpayGateway('k', 's', '');
    expect(noHook.verifyWebhook(body, sign('', body))).toBe(false); // an empty key would be forgeable
  });
});

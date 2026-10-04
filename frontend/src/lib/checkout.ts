import { ApiError } from './api';
import { payApi, type CheckoutOrder, type OrderView } from './ems-api';

export interface PaidResult {
  gatewayOrderId: string;
  paymentId: string;
  signature: string;
}

// Razorpay's checkout.js is injected only when someone actually pays (0 KB in our bundle).
let script: Promise<void> | null = null;
function loadRazorpay() {
  script ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      script = null;
      reject(new ApiError(0, 'NETWORK', "Couldn't open the payment window. Check your connection and try again."));
    };
    document.head.appendChild(s);
  });
  return script;
}

/** Opens Razorpay Checkout. Resolves with the signed result, or null if the person closed it. */
export async function openRazorpay(o: CheckoutOrder): Promise<PaidResult | null> {
  await loadRazorpay();
  const Razorpay = (window as unknown as { Razorpay: new (opts: object) => { open(): void } }).Razorpay;
  return new Promise((resolve) => {
    new Razorpay({
      key: o.keyId,
      order_id: o.gatewayOrderId,
      amount: o.amountPaise,
      currency: o.currency,
      name: 'NEC Events',
      description: o.description,
      prefill: o.prefill,
      theme: { color: '#4f46e5' },
      handler: (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) =>
        resolve({ gatewayOrderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature }),
      modal: { ondismiss: () => resolve(null) },
    }).open();
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Confirm with the server. If the network drops right after paying, poll the order for up to a
 * minute instead: the gateway's webhook settles it on the server either way.
 */
export async function confirmPayment(orderCode: string, result: PaidResult): Promise<OrderView> {
  try {
    return await payApi.verify(orderCode, result);
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 0) throw e;
    for (let i = 0; i < 30; i++) {
      await sleep(2000);
      const s = await payApi.status(orderCode).catch(() => null);
      if (s?.status === 'PAID') return s;
    }
    throw new ApiError(0, 'PENDING', "We're still confirming your payment. Check this page again in a minute.");
  }
}

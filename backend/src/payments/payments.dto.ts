import { z } from 'zod';
import { objectId } from '../common/util';

export const VerifyDto = z.object({
  gatewayOrderId: z.string().trim().min(1).max(100),
  paymentId: z.string().trim().min(1).max(100),
  signature: z.string().trim().regex(/^[a-f0-9]{64}$/i, 'Invalid signature'),
});
export type VerifyDto = z.infer<typeof VerifyDto>;

export const CollectDto = z.object({ amountPaise: z.number().int().min(1).max(10_000_000) });

export const OrderListQuery = z.object({
  festId: objectId,
  status: z.enum(['CREATED', 'PAID']).optional(),
  mode: z.enum(['ONLINE', 'OFFLINE']).optional(),
  cursor: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type OrderListQuery = z.infer<typeof OrderListQuery>;

export const FeeSettingsDto = z.object({
  platformFeeBps: z.number().int().min(0).max(1_000), // ≤ 10 %
  platformFeeFlatPaise: z.number().int().min(0).max(100_000), // ≤ ₹1,000
  gstBps: z.number().int().min(0).max(2_800), // ≤ 28 %
  feeBearer: z.enum(['PARTICIPANT', 'ORGANIZER']),
});

export const ORDER_CODE = /^ORD-[A-Z0-9]{8}$/;

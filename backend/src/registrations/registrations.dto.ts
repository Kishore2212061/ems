import { z } from 'zod';
import { objectId } from '../common/util';
import { REGISTRATION_STATUS } from './registration.schema';

const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, ''))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'));

const Teammate = z.object({
  name: z.string().trim().min(2, 'Enter their name').max(80),
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address').max(254)),
  phone: phone.nullish().transform((v) => v ?? null),
});

export const CreateRegistrationDto = z.object({
  eventId: objectId,
  teamName: z
    .string()
    .trim()
    .max(60)
    .nullish()
    .transform((v) => v || null),
  /** Everyone except the signed-in person, who is always the leader. */
  teammates: z.array(Teammate).max(19).default([]),
  paymentMode: z.enum(['ONLINE', 'OFFLINE']).optional(),
});
export type CreateRegistrationDto = z.infer<typeof CreateRegistrationDto>;

/** Client-generated per attempt (e.g. a UUID); the same key always returns the first result. */
export const IdempotencyKey = z
  .string({ message: 'Idempotency-Key header is required' })
  .regex(/^[A-Za-z0-9_-]{16,64}$/, 'Idempotency-Key must be 16–64 letters, digits, - or _');

export const CODE = /^REG-[A-Z0-9]{6}$/;

export const AdminRegistrationQuery = z.object({
  status: z.enum(REGISTRATION_STATUS).optional(),
  /** A registration code or an exact email. */
  q: z.string().trim().max(254).optional(),
  cursor: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AdminRegistrationQuery = z.infer<typeof AdminRegistrationQuery>;

export const CancelDto = z.object({ reason: z.string().trim().max(300).optional() });
export const AdminCancelDto = z.object({ reason: z.string().trim().min(3, 'Give a short reason').max(300) });

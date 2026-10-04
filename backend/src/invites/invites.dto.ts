import { z } from 'zod';
import { objectId } from '../common/util';
import { ROLES, SCOPE_TYPES } from '../users/user.schema';
import { INVITE_STATUS } from './invite.schema';

export const CreateInviteDto = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address').max(254)),
  role: z.enum(ROLES),
  scopeType: z.enum(SCOPE_TYPES),
  scopeId: objectId.nullish(),
});
export type CreateInviteDto = z.infer<typeof CreateInviteDto>;

export const AcceptInviteDto = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name').max(80).optional(),
  password: z
    .string()
    .min(8, 'Use at least 8 characters')
    .max(128)
    .regex(/[A-Za-z]/, 'Include at least one letter')
    .regex(/\d/, 'Include at least one number')
    .optional(),
});
export type AcceptInviteDto = z.infer<typeof AcceptInviteDto>;

export const InviteListQuery = z.object({ status: z.enum(INVITE_STATUS).default('PENDING') });

export const InviteToken = z.string().regex(/^[A-Za-z0-9_-]{30,60}$/);

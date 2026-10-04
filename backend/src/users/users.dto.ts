import { z } from 'zod';
import { PageQuery } from '../common/util';
import { ROLES, USER_STATUS } from './user.schema';

export const ProfileDto = z
  .object({
    fullName: z.string().trim().min(2, 'Enter your full name').max(80),
    phone: z
      .string()
      .trim()
      .transform((v) => v.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, ''))
      .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number')),
    college: z.string().trim().min(2, 'Enter your college name').max(120),
  })
  .partial();
export type ProfileDto = z.infer<typeof ProfileDto>;

export const UserListQuery = PageQuery.extend({
  q: z.string().trim().max(80).optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(USER_STATUS).optional(),
});
export type UserListQuery = z.infer<typeof UserListQuery>;

import { z } from 'zod';
import { objectId } from '../common/util';
import { FEST_STATUS, FEST_TYPES } from './global-event.schema';

const date = z.iso.datetime({ offset: true, message: 'Invalid date' }).transform((v) => new Date(v));
const optText = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));

const fields = {
  name: z.string().trim().min(3, 'Enter the fest name').max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens')
    .max(60)
    .optional(),
  editionYear: z.number().int().min(2000).max(2100),
  type: z.enum(FEST_TYPES).default('TECHNICAL'),
  tagline: optText(160),
  description: optText(5000),
  startsAt: date.nullish(),
  endsAt: date.nullish(),
  venue: optText(160),
  bannerUrl: z
    .union([z.url({ protocol: /^https$/ }).max(500), z.string().regex(/^\/(media|api\/v1\/media)\/[a-z0-9][a-z0-9/_-]*\.(webp|png|jpe?g|avif)$/i)], {
      message: 'Use an https:// image URL',
    })
    .nullish(),
  contactEmail: z.email('Enter a valid email').max(254).nullish(),
  departmentIds: z.array(objectId).max(50).optional(),
};

const datesInOrder = (v: { startsAt?: Date | null; endsAt?: Date | null }) => !(v.startsAt && v.endsAt) || v.endsAt >= v.startsAt;
const DATE_MSG = { message: 'End must be after start', path: ['endsAt'] };

export const CreateFestDto = z.object(fields).refine(datesInOrder, DATE_MSG);
export type CreateFestDto = z.infer<typeof CreateFestDto>;

export const UpdateFestDto = z
  .object({ ...fields, type: z.enum(FEST_TYPES).optional(), version: z.number().int().min(0) })
  .partial({ name: true, editionYear: true })
  .refine(datesInOrder, DATE_MSG);
export type UpdateFestDto = z.infer<typeof UpdateFestDto>;

export const SetDepartmentsDto = z.object({ departmentIds: z.array(objectId).max(50), version: z.number().int().min(0) });
export type SetDepartmentsDto = z.infer<typeof SetDepartmentsDto>;

export const SuspendDto = z.object({ reason: z.string().trim().min(3, 'Give a short reason').max(300) });
export const CloneDto = z.object({ editionYear: z.number().int().min(2000).max(2100), name: z.string().trim().min(3).max(120).optional() });
export type CloneDto = z.infer<typeof CloneDto>;

export const AdminFestQuery = z.object({ status: z.enum(FEST_STATUS).optional() });

import { z } from 'zod';

export const DepartmentDto = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,10}$/, 'Use 2–10 letters or digits, e.g. CSE'),
  name: z.string().trim().min(2, 'Enter the department name').max(80),
  associationName: z.string().trim().max(120).nullish(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
export type DepartmentDto = z.infer<typeof DepartmentDto>;

export const UpdateDepartmentDto = DepartmentDto.partial();
export type UpdateDepartmentDto = z.infer<typeof UpdateDepartmentDto>;

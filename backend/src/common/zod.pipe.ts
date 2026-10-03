import { PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { Errors } from './app-exception';

/** Validates + strips unknown keys. Much lighter than class-validator/class-transformer. */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const r = this.schema.safeParse(value ?? {});
    if (r.success) return r.data;
    const fields: Record<string, string> = {};
    for (const i of r.error.issues) {
      const key = i.path.join('.') || '_';
      fields[key] ??= i.message;
    }
    throw Errors.validation({ fields });
  }
}

import { z } from 'zod';
import { env } from '../config/env';

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address').max(254));

const password = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128, 'Use at most 128 characters')
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/\d/, 'Include at least one number');

export const SignupDto = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name').max(80),
  email,
  // Indian mobile: optional +91 / 0 prefix, 10 digits starting 6-9. Stored as the bare 10 digits.
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, ''))
    .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number')),
  college: z.string().trim().min(2, 'Enter your college name').max(120),
  password,
});
export type SignupDto = z.infer<typeof SignupDto>;

export const LoginDto = z.object({
  email,
  password: z.string().min(1, 'Enter your password').max(128),
});
export type LoginDto = z.infer<typeof LoginDto>;

export const VerifyOtpDto = z.object({
  otpToken: z.string().min(1).max(1000),
  code: z.string().trim().regex(new RegExp(`^\\d{${env.OTP_LENGTH}}$`), `Enter the ${env.OTP_LENGTH}-digit code`),
});
export type VerifyOtpDto = z.infer<typeof VerifyOtpDto>;

export const ForgotPasswordDto = z.object({ email });
export type ForgotPasswordDto = z.infer<typeof ForgotPasswordDto>;

export const ResetPasswordDto = z.object({
  otpToken: z.string().min(1).max(1000),
  code: VerifyOtpDto.shape.code,
  password,
});
export type ResetPasswordDto = z.infer<typeof ResetPasswordDto>;

export const ResendOtpDto = z.object({ otpToken: z.string().min(1).max(1000) });
export type ResendOtpDto = z.infer<typeof ResendOtpDto>;

export const ChangePasswordDto = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password').max(128),
    newPassword: password,
  })
  .refine((v) => v.currentPassword !== v.newPassword, { message: 'Choose a different password', path: ['newPassword'] });
export type ChangePasswordDto = z.infer<typeof ChangePasswordDto>;

import { HttpException, HttpStatus } from '@nestjs/common';

/** Every API error carries a stable machine-readable `code` the frontend can switch on. */
export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, status);
  }
}

export const Errors = {
  validation: (details: Record<string, unknown>) =>
    new AppException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Please check the highlighted fields', details),
  invalidCredentials: () =>
    new AppException(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Incorrect email or password'),
  accountLocked: (retryAfterSec: number) =>
    new AppException(HttpStatus.LOCKED, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.', { retryAfterSec }),
  accountSuspended: () =>
    new AppException(HttpStatus.FORBIDDEN, 'ACCOUNT_SUSPENDED', 'This account has been suspended'),
  emailTaken: () =>
    new AppException(HttpStatus.CONFLICT, 'EMAIL_TAKEN', 'An account with this email already exists'),
  otpInvalid: (attemptsLeft: number) =>
    new AppException(HttpStatus.BAD_REQUEST, 'OTP_INVALID', 'Incorrect code', { attemptsLeft }),
  otpExpired: () =>
    new AppException(HttpStatus.BAD_REQUEST, 'OTP_EXPIRED', 'This code has expired. Request a new one.'),
  otpLocked: () =>
    new AppException(HttpStatus.BAD_REQUEST, 'OTP_ATTEMPTS_EXCEEDED', 'Too many wrong attempts. Request a new code.'),
  otpSession: () =>
    new AppException(HttpStatus.UNAUTHORIZED, 'OTP_SESSION_EXPIRED', 'Verification session expired. Please log in again.'),
  otpCooldown: (retryAfterSec: number) =>
    new AppException(HttpStatus.TOO_MANY_REQUESTS, 'OTP_COOLDOWN', 'Please wait before requesting another code', { retryAfterSec }),
  unauthorized: (code = 'UNAUTHORIZED', message = 'Please log in to continue') =>
    new AppException(HttpStatus.UNAUTHORIZED, code, message),
};

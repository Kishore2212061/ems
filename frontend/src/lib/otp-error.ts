import { ApiError } from './api';

/** Turns OTP_INVALID + attemptsLeft into a friendly message. */
export function otpErrorMessage(e: unknown) {
  if (e instanceof ApiError && e.code === 'OTP_INVALID' && e.details?.attemptsLeft != null) {
    const n = e.details.attemptsLeft;
    return new ApiError(e.status, e.code, `Incorrect code. ${n} attempt${n === 1 ? '' : 's'} left.`);
  }
  return e;
}

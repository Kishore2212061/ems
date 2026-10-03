import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppException } from './app-exception';

/** Uniform error body: { statusCode, code, message, details? } */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const req = ctx.getRequest<FastifyRequest>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Something went wrong. Please try again.';
    let details: Record<string, unknown> | undefined;

    if (exception instanceof AppException) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof ThrottlerException) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      code = 'RATE_LIMITED';
      message = 'Too many requests. Please slow down.';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = HttpStatus[status] ?? 'HTTP_ERROR';
      message = exception.message;
    } else {
      this.logger.error(`${req.method} ${req.url}`, (exception as Error)?.stack ?? String(exception));
    }

    reply.status(status).send({ statusCode: status, code, message, ...(details && { details }) });
  }
}

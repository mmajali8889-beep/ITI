import { ArgumentsHost, Catch, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { OperationOutcomeError } from '@medplum/core';

const RETRY_AFTER_SECONDS = 5;

/**
 * Medplum rate limits surface as an OperationOutcomeError with a
 * "throttled" issue ("Too Many Requests"). Left alone, Nest reports them as
 * 500. Map them to 503 so callers know the request can be retried.
 */
export function isMedplumRateLimitError(error: unknown): boolean {
  if (!(error instanceof OperationOutcomeError)) return false;
  if ((error as { status?: number }).status === 429) return true;
  return (
    error.outcome?.issue?.some(
      (issue) =>
        issue.code === 'throttled' ||
        issue.details?.text === 'Too Many Requests',
    ) ?? false
  );
}

@Catch()
export class MedplumRateLimitFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    if (!isMedplumRateLimitError(exception) || host.getType() !== 'http') {
      return super.catch(exception, host);
    }

    const response = host.switchToHttp().getResponse();
    response.setHeader?.('Retry-After', String(RETRY_AFTER_SECONDS));
    response.status(HttpStatus.SERVICE_UNAVAILABLE).json({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      error: 'Service Unavailable',
      message:
        'The clinical data store is rate limiting requests. Please retry in a few seconds.',
    });
  }
}

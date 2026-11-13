import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Response } from 'express';

/** Multer corta los archivos grandes con un mensaje en inglés; lo devolvemos en español. */
@Catch(PayloadTooLargeException)
export class UploadErrorsFilter implements ExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<Response>().status(413).json({
      statusCode: 413,
      error: 'Payload Too Large',
      message: 'El archivo supera el máximo de 5 MB.',
    });
  }
}

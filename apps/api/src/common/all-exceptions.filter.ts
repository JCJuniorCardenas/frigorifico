import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/** Formato único de error de la API. */
export interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  code?: string;
  [extra: string]: unknown;
}

const DEFAULT_MESSAGES: Partial<Record<number, string>> = {
  400: 'La solicitud no es válida.',
  401: 'Tenés que iniciar sesión.',
  403: 'No tenés permisos para realizar esta acción.',
  404: 'No se encontró lo que buscabas.',
  409: 'Hay un conflicto con datos existentes.',
  413: 'El archivo es demasiado grande.',
  422: 'No se pudo procesar el archivo.',
  429: 'Demasiados intentos. Esperá un minuto y probá de nuevo.',
};

/** Mensajes de Nest/Express en inglés que conviene traducir. */
function isFrameworkEnglish(message: string): boolean {
  return /^(Cannot (GET|POST|PATCH|PUT|DELETE)|Not Found|Forbidden resource|Unauthorized|Too Many Requests|ThrottlerException|Unexpected field|Multipart|File too large|Validation failed)/i.test(
    message,
  );
}

/**
 * Todas las respuestas de error salen con el mismo formato y en español. Los errores
 * inesperados (500) se registran en el log con su detalle, pero al cliente solo le llega un
 * mensaje genérico: nunca se filtran stacks, SQL ni datos internos.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errores');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request>();
    if (res.headersSent) return;

    if (!(exception instanceof HttpException)) {
      this.logger.error(
        `${req.method} ${req.originalUrl}: ${exception instanceof Error ? exception.message : String(exception)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'Ocurrió un error inesperado. Probá de nuevo en unos minutos.',
      } satisfies ErrorBody);
      return;
    }

    const status = exception.getStatus();
    const response = exception.getResponse();
    const body: ErrorBody =
      typeof response === 'object' && response !== null
        ? ({ ...(response as Record<string, unknown>), statusCode: status } as ErrorBody)
        : { statusCode: status, error: exception.name, message: String(response) };
    body.error ??= exception.name;

    const message = body.message;
    if (message === undefined || (typeof message === 'string' && isFrameworkEnglish(message))) {
      body.message = DEFAULT_MESSAGES[status] ?? 'No se pudo completar la solicitud.';
    }
    if (status >= 500) {
      this.logger.error(`${req.method} ${req.originalUrl}: ${JSON.stringify(body.message)}`);
    }
    res.status(status).json(body);
  }
}

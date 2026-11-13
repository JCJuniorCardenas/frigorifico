import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { CreateInvoiceDto } from './dto/create-invoice.dto.js';
import type { InvoiceResponse } from './invoice.mapper.js';
import { InvoicesService, type ParseResponse } from './invoices.service.js';
import { UploadErrorsFilter } from './upload/upload-errors.filter.js';
import { MAX_PDF_BYTES, type UploadedFileLike } from './upload/uploaded-pdf.js';

/** Un solo archivo en el campo "file", en memoria (nunca se escribe a disco sin validar). */
const pdfUpload = FileInterceptor('file', {
  limits: { fileSize: MAX_PDF_BYTES, files: 1, fields: 5, parts: 6 },
});

@Controller('invoices')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@UseFilters(UploadErrorsFilter)
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  /** Sube un PDF y devuelve el borrador con advertencias, sin guardar. */
  @Post('parse')
  @HttpCode(200)
  @UseInterceptors(pdfUpload)
  parse(@UploadedFile() file: UploadedFileLike | undefined): Promise<ParseResponse> {
    return this.invoices.parse(file);
  }

  /**
   * Confirma y guarda la factura. Multipart con el PDF en "file" y los datos revisados en "data"
   * (JSON con los campos de CreateInvoiceDto).
   */
  @Post()
  @UseInterceptors(pdfUpload)
  async create(
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body('data') rawData: unknown,
    @CurrentUser() user: AuthUser,
  ): Promise<InvoiceResponse> {
    const dto = await parseJsonDto(CreateInvoiceDto, rawData);
    return this.invoices.create(file, dto, user);
  }

  @Get(':id')
  findOne(
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ): Promise<InvoiceResponse> {
    return this.invoices.findOne(id);
  }
}

/** Valida un campo multipart que trae JSON, con las mismas reglas que un body común. */
async function parseJsonDto<T extends object>(cls: new () => T, raw: unknown): Promise<T> {
  let plain: unknown;
  try {
    plain = typeof raw === 'string' ? JSON.parse(raw) : undefined;
  } catch {
    plain = undefined;
  }
  if (typeof plain !== 'object' || plain === null || Array.isArray(plain)) {
    throw new BadRequestException('Faltan los datos de la factura (campo "data" en JSON).');
  }
  const dto = plainToInstance(cls, plain);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length > 0) {
    const messages = errors.flatMap((e) =>
      e.constraints ? Object.values(e.constraints) : [`Campo inválido: ${e.property}`],
    );
    throw new BadRequestException(messages);
  }
  return dto;
}

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
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
import { Roles } from '../common/decorators/roles.decorator.js';
import { CreateInvoiceDto } from './dto/create-invoice.dto.js';
import { ListInvoicesQueryDto } from './dto/list-invoices.dto.js';
import { BulkChangeStatusDto, ChangeStatusDto } from './dto/status.dto.js';
import { UpdateInvoiceDto } from './dto/update-invoice.dto.js';
import type { InvoiceListItem, InvoiceResponse } from './invoice.mapper.js';
import { type InvoiceDetail, InvoiceManagementService } from './invoice-management.service.js';
import {
  type ClientOption,
  type InvoiceListResponse,
  InvoiceQueryService,
  type InvoiceSummary,
} from './invoice-query.service.js';
import { InvoiceStatusService, type StatusChangeResult } from './invoice-status.service.js';
import { InvoicesService, type ParseResponse } from './invoices.service.js';
import { UploadErrorsFilter } from './upload/upload-errors.filter.js';
import { MAX_PDF_BYTES, type UploadedFileLike } from './upload/uploaded-pdf.js';

/** Un solo archivo en el campo "file", en memoria (nunca se escribe a disco sin validar). */
const pdfUpload = FileInterceptor('file', {
  limits: { fileSize: MAX_PDF_BYTES, files: 1, fields: 5, parts: 6 },
});

const uuidParam = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

// Las rutas fijas (summary, clients, status/bulk) van antes que las de ":id".
@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly queries: InvoiceQueryService,
    private readonly statuses: InvoiceStatusService,
    private readonly management: InvoiceManagementService,
  ) {}

  @Get()
  list(@Query() query: ListInvoicesQueryDto): Promise<InvoiceListResponse> {
    return this.queries.list(query);
  }

  @Get('summary')
  summary(): Promise<InvoiceSummary> {
    return this.queries.summary();
  }

  @Get('clients')
  clients(): Promise<ClientOption[]> {
    return this.queries.clients();
  }

  /** Sube un PDF y devuelve el borrador con advertencias, sin guardar. */
  @Post('parse')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseFilters(UploadErrorsFilter)
  @UseInterceptors(pdfUpload)
  parse(@UploadedFile() file: UploadedFileLike | undefined): Promise<ParseResponse> {
    return this.invoices.parse(file);
  }

  /**
   * Confirma y guarda la factura. Multipart con el PDF en "file" y los datos revisados en "data"
   * (JSON con los campos de CreateInvoiceDto).
   */
  @Post()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseFilters(UploadErrorsFilter)
  @UseInterceptors(pdfUpload)
  async create(
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body('data') rawData: unknown,
    @CurrentUser() user: AuthUser,
  ): Promise<InvoiceResponse> {
    const dto = await parseJsonDto(CreateInvoiceDto, rawData);
    return this.invoices.create(file, dto, user);
  }

  /** Marcado masivo de estado (pagadas / pendientes). */
  @Post('status/bulk')
  @HttpCode(200)
  bulkStatus(
    @Body() dto: BulkChangeStatusDto,
    @CurrentUser() user: AuthUser,
  ): Promise<StatusChangeResult> {
    return this.statuses.change(dto.ids, dto.status, dto.paidAt, user);
  }

  @Get(':id')
  detail(@Param('id', uuidParam) id: string): Promise<InvoiceDetail> {
    return this.management.detail(id);
  }

  /** Stream del PDF original. Solo con sesión; nunca hay URLs públicas. */
  @Get(':id/pdf')
  async pdf(@Param('id', uuidParam) id: string): Promise<StreamableFile> {
    const { stream, filename } = await this.management.pdf(id);
    return new StreamableFile(stream, {
      type: 'application/pdf',
      disposition: `inline; filename="${filename}"`,
    });
  }

  @Patch(':id')
  update(
    @Param('id', uuidParam) id: string,
    @Body() dto: UpdateInvoiceDto,
  ): Promise<InvoiceListItem> {
    return this.management.update(id, dto);
  }

  @Patch(':id/status')
  async changeStatus(
    @Param('id', uuidParam) id: string,
    @Body() dto: ChangeStatusDto,
    @CurrentUser() user: AuthUser,
  ): Promise<InvoiceListItem> {
    const result = await this.statuses.change([id], dto.status, dto.paidAt, user);
    return result.items[0];
  }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(204)
  remove(@Param('id', uuidParam) id: string): Promise<void> {
    return this.management.remove(id);
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

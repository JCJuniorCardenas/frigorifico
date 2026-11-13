import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { Prisma, type Invoice } from '../generated/prisma/client.js';
import type { AuthUser } from '../common/auth-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import type { CreateInvoiceDto } from './dto/create-invoice.dto.js';
import {
  fromIsoDate,
  type InvoiceDraft,
  type InvoiceResponse,
  toDraft,
  toInvoiceResponse,
} from './invoice.mapper.js';
import { isValidCuit } from './parser/cuit.js';
import { InvoiceParserService } from './parser/invoice-parser.service.js';
import {
  InvoiceParseError,
  type InvoiceParseResult,
  type ParseWarning,
} from './parser/parsed-invoice.js';
import { type UploadedFileLike, validateUploadedPdf } from './upload/uploaded-pdf.js';

export interface ParseResponse {
  draft: InvoiceDraft;
  warnings: ParseWarning[];
  needsReview: boolean;
  fileHash: string;
}

type DuplicateReason = 'SAME_FILE' | 'SAME_VOUCHER';

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: InvoiceParserService,
    private readonly storage: StorageService,
  ) {}

  /** Lee el PDF y devuelve el borrador para revisar. No guarda nada. */
  async parse(file: UploadedFileLike | undefined): Promise<ParseResponse> {
    const pdf = validateUploadedPdf(file);
    await this.assertNotDuplicatedFile(pdf.hash);

    const result = await this.parsePdf(pdf.data);
    const { salesPoint, voucherNumber, herdNumber } = result.invoice;
    if (salesPoint && voucherNumber) {
      await this.assertNotDuplicatedVoucher(salesPoint, voucherNumber);
    }
    const warnings = [...result.warnings];
    if (herdNumber) {
      const herdWarning = await this.herdDuplicateWarning(herdNumber);
      if (herdWarning) warnings.push(herdWarning);
    }
    return {
      draft: toDraft(result.invoice),
      warnings,
      needsReview: warnings.length > 0,
      fileHash: pdf.hash,
    };
  }

  /**
   * Guarda la factura confirmada por el usuario junto con su PDF. El archivo se vuelve a enviar
   * (el borrador no se guarda en el servidor), así que se revalida y se vuelven a chequear duplicados.
   */
  async create(
    file: UploadedFileLike | undefined,
    dto: CreateInvoiceDto,
    user: AuthUser,
  ): Promise<InvoiceResponse> {
    const pdf = validateUploadedPdf(file);
    const dates = this.parseDates(dto);
    await this.assertNotDuplicatedFile(pdf.hash);
    await this.assertNotDuplicatedVoucher(dto.salesPoint, dto.voucherNumber);

    // Se relee el PDF para confirmar que es una factura válida y recuperar sus advertencias.
    const parsed = await this.parsePdf(pdf.data);
    const needsReview =
      parsed.needsReview ||
      (await this.herdDuplicateWarning(dto.herdNumber)) !== null ||
      this.valuesNeedReview(dto, dates, parsed);

    const pdfKey = `invoices/${dates.issueDate.getUTCFullYear()}/${randomUUID()}.pdf`;
    await this.storage.put(pdfKey, pdf.data);
    try {
      const invoice = await this.prisma.invoice.create({
        data: {
          salesPoint: dto.salesPoint,
          voucherNumber: dto.voucherNumber,
          issueDate: dates.issueDate,
          paymentDueDate: dates.paymentDueDate,
          clientName: dto.clientName,
          clientCuit: dto.clientCuit,
          herdNumber: dto.herdNumber,
          slaughterKg: dto.slaughterKg,
          totalAmount: dto.totalAmount,
          netTaxedAmount: dto.netTaxedAmount,
          vat21Amount: dto.vat21Amount,
          exemptAmount: dto.exemptAmount,
          cae: dto.cae,
          caeDueDate: dates.caeDueDate,
          pdfKey,
          pdfHash: pdf.hash,
          needsReview,
          uploadedById: user.id,
        },
      });
      return toInvoiceResponse(invoice);
    } catch (error) {
      // Si no se pudo guardar en la base, no dejamos el PDF huérfano.
      await this.storage.delete(pdfKey).catch((e: unknown) => {
        this.logger.error(`No se pudo borrar el PDF huérfano ${pdfKey}`, e);
      });
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Carrera: otra carga del mismo PDF/comprobante se guardó entre el chequeo y el insert.
        await this.assertNotDuplicatedFile(pdf.hash);
        await this.assertNotDuplicatedVoucher(dto.salesPoint, dto.voucherNumber);
      }
      throw error;
    }
  }

  private async parsePdf(data: Uint8Array): Promise<InvoiceParseResult> {
    try {
      return await this.parser.parse(data);
    } catch (error) {
      if (error instanceof InvoiceParseError) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          error: 'Unprocessable Entity',
          code: error.code,
          message: error.message,
        });
      }
      throw error;
    }
  }

  private async assertNotDuplicatedFile(hash: string): Promise<void> {
    const existing = await this.prisma.invoice.findUnique({ where: { pdfHash: hash } });
    if (existing) throw this.duplicateError(existing, 'SAME_FILE');
  }

  private async assertNotDuplicatedVoucher(salesPoint: string, voucherNumber: string) {
    const existing = await this.prisma.invoice.findUnique({
      where: { salesPoint_voucherNumber: { salesPoint, voucherNumber } },
    });
    if (existing) throw this.duplicateError(existing, 'SAME_VOUCHER');
  }

  private duplicateError(existing: Invoice, reason: DuplicateReason): ConflictException {
    const voucher = `${existing.salesPoint}-${existing.voucherNumber}`;
    const message =
      reason === 'SAME_FILE'
        ? `Este PDF ya fue cargado: factura ${voucher} de ${existing.clientName}.`
        : `Ya existe la factura ${voucher} (cliente ${existing.clientName}).`;
    return new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      code: 'DUPLICATE_INVOICE',
      message,
      duplicate: {
        id: existing.id,
        reason,
        salesPoint: existing.salesPoint,
        voucherNumber: existing.voucherNumber,
        clientName: existing.clientName,
      },
    });
  }

  /** Aviso (no bloquea) si la tropa ya figura en otra factura. */
  private async herdDuplicateWarning(herdNumber: string): Promise<ParseWarning | null> {
    const others = await this.prisma.invoice.findMany({
      where: { herdNumber },
      select: { salesPoint: true, voucherNumber: true, clientName: true },
      take: 3,
    });
    if (others.length === 0) return null;
    const list = others
      .map((o) => `${o.salesPoint}-${o.voucherNumber} (${o.clientName})`)
      .join(', ');
    return {
      code: 'HERD_DUPLICATE',
      field: 'herdNumber',
      message: `La tropa ${herdNumber} ya figura en otra factura: ${list}. Verificá que no sea un duplicado.`,
    };
  }

  private parseDates(dto: CreateInvoiceDto) {
    const parse = (value: string, label: string): Date => {
      const date = fromIsoDate(value);
      if (!date) throw new BadRequestException(`${label} no es una fecha válida: ${value}`);
      return date;
    };
    return {
      issueDate: parse(dto.issueDate, 'La fecha de emisión'),
      paymentDueDate: parse(dto.paymentDueDate, 'La fecha de vencimiento'),
      caeDueDate: parse(dto.caeDueDate, 'La fecha de vencimiento del CAE'),
    };
  }

  /** Chequeos sobre los valores confirmados (pudieron editarse en la pantalla de revisión). */
  private valuesNeedReview(
    dto: CreateInvoiceDto,
    dates: { issueDate: Date; paymentDueDate: Date },
    parsed: InvoiceParseResult,
  ): boolean {
    const computedTotal = new Decimal(dto.netTaxedAmount)
      .plus(dto.vat21Amount)
      .plus(dto.exemptAmount)
      .plus(parsed.invoice.otherTaxesAmount ?? 0);
    return (
      !computedTotal.equals(dto.totalAmount) ||
      !isValidCuit(dto.clientCuit) ||
      dates.paymentDueDate < dates.issueDate
    );
  }
}

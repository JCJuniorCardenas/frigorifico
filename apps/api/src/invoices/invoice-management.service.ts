import type { Readable } from 'node:stream';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { todayInArgentina } from './due-dates.js';
import type { UpdateInvoiceDto } from './dto/update-invoice.dto.js';
import { fromIsoDate, type InvoiceListItem, toListItem } from './invoice.mapper.js';

export interface InvoiceDetail extends InvoiceListItem {
  uploadedBy: string;
  paidBy: string | null;
  statusLogs: {
    fromStatus: 'PENDING' | 'PAID';
    toStatus: 'PENDING' | 'PAID';
    changedBy: string;
    changedAt: string;
  }[];
}

@Injectable()
export class InvoiceManagementService {
  private readonly logger = new Logger(InvoiceManagementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async detail(id: string, now = new Date()): Promise<InvoiceDetail> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        uploadedBy: { select: { name: true } },
        paidBy: { select: { name: true } },
        statusLogs: {
          orderBy: { changedAt: 'desc' },
          include: { changedBy: { select: { name: true } } },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Factura no encontrada');
    return {
      ...toListItem(invoice, todayInArgentina(now)),
      uploadedBy: invoice.uploadedBy.name,
      paidBy: invoice.paidBy?.name ?? null,
      statusLogs: invoice.statusLogs.map((log) => ({
        fromStatus: log.fromStatus,
        toStatus: log.toStatus,
        changedBy: log.changedBy.name,
        changedAt: log.changedAt.toISOString(),
      })),
    };
  }

  async update(id: string, dto: UpdateInvoiceDto, now = new Date()): Promise<InvoiceListItem> {
    const date = (value: string | undefined, label: string): Date | undefined => {
      if (value === undefined) return undefined;
      const parsed = fromIsoDate(value);
      if (!parsed) throw new BadRequestException(`${label} no es una fecha válida: ${value}`);
      return parsed;
    };
    const data: Prisma.InvoiceUpdateInput = {
      salesPoint: dto.salesPoint,
      voucherNumber: dto.voucherNumber,
      issueDate: date(dto.issueDate, 'La fecha de emisión'),
      paymentDueDate: date(dto.paymentDueDate, 'La fecha de vencimiento'),
      clientName: dto.clientName,
      clientCuit: dto.clientCuit,
      herdNumber: dto.herdNumber,
      slaughterKg: dto.slaughterKg,
      totalAmount: dto.totalAmount,
      netTaxedAmount: dto.netTaxedAmount,
      vat21Amount: dto.vat21Amount,
      exemptAmount: dto.exemptAmount,
      cae: dto.cae,
      caeDueDate: date(dto.caeDueDate, 'La fecha de vencimiento del CAE'),
      needsReview: dto.needsReview,
    };
    try {
      const invoice = await this.prisma.invoice.update({ where: { id }, data });
      return toListItem(invoice, todayInArgentina(now));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') throw new NotFoundException('Factura no encontrada');
        if (error.code === 'P2002') {
          throw new ConflictException('Ya existe otra factura con ese punto de venta y número.');
        }
      }
      throw error;
    }
  }

  /** Borra la factura (y su historial) y después el PDF del storage. */
  async remove(id: string): Promise<void> {
    let pdfKey: string;
    try {
      ({ pdfKey } = await this.prisma.invoice.delete({ where: { id }, select: { pdfKey: true } }));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('Factura no encontrada');
      }
      throw error;
    }
    await this.storage.delete(pdfKey).catch((e: unknown) => {
      this.logger.error(`No se pudo borrar el PDF ${pdfKey} de la factura ${id}`, e);
    });
  }

  async pdf(id: string): Promise<{ stream: Readable; filename: string }> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      select: { pdfKey: true, salesPoint: true, voucherNumber: true },
    });
    if (!invoice) throw new NotFoundException('Factura no encontrada');
    const stream = await this.storage.get(invoice.pdfKey);
    if (!stream) throw new NotFoundException('El PDF de esta factura no está disponible.');
    return { stream, filename: `factura-${invoice.salesPoint}-${invoice.voucherNumber}.pdf` };
  }
}

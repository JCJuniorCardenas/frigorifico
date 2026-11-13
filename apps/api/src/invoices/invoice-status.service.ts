import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import type { AuthUser } from '../common/auth-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { todayInArgentina } from './due-dates.js';
import { fromIsoDate, type InvoiceListItem, toListItem } from './invoice.mapper.js';

export interface StatusChangeResult {
  /** Facturas actualizadas (estado nuevo). */
  items: InvoiceListItem[];
  /** Cuántas cambiaron de estado (las que ya estaban en ese estado no generan registro). */
  changed: number;
}

@Injectable()
export class InvoiceStatusService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Marca facturas como pagadas o pendientes. Cada cambio de estado deja un registro de auditoría
   * (quién y cuándo). Al pagar se guarda la fecha de cobro (por defecto hoy) y el usuario;
   * al revertir a pendiente se limpian ambos.
   */
  async change(
    ids: string[],
    status: 'PENDING' | 'PAID',
    paidAtRaw: string | undefined,
    actor: AuthUser,
    now = new Date(),
  ): Promise<StatusChangeResult> {
    const today = todayInArgentina(now);
    if (status === 'PENDING' && paidAtRaw) {
      throw new BadRequestException('La fecha de pago solo se indica al marcar como pagada.');
    }
    const paidAt = status === 'PAID' ? this.resolvePaidAt(paidAtRaw, today) : null;

    return this.prisma.$transaction(async (tx) => {
      const invoices = await tx.invoice.findMany({ where: { id: { in: ids } } });
      if (invoices.length !== ids.length) {
        const missing = ids.length - invoices.length;
        throw new NotFoundException(
          missing === 1 ? 'Una de las facturas no existe.' : `${missing} facturas no existen.`,
        );
      }

      let changed = 0;
      for (const invoice of invoices) {
        const data: Prisma.InvoiceUncheckedUpdateInput = {};
        if (invoice.status !== status) {
          changed++;
          data.status = status;
          data.paidAt = paidAt;
          data.paidById = status === 'PAID' ? actor.id : null;
          await tx.invoiceStatusLog.create({
            data: {
              invoiceId: invoice.id,
              fromStatus: invoice.status,
              toStatus: status,
              changedById: actor.id,
            },
          });
        } else if (
          status === 'PAID' &&
          paidAtRaw &&
          invoice.paidAt?.getTime() !== paidAt?.getTime()
        ) {
          // Ya estaba pagada: solo se corrige la fecha de cobro.
          data.paidAt = paidAt;
        }
        if (Object.keys(data).length > 0) {
          await tx.invoice.update({ where: { id: invoice.id }, data });
        }
      }

      const updated = await tx.invoice.findMany({ where: { id: { in: ids } } });
      return { items: updated.map((i) => toListItem(i, today)), changed };
    });
  }

  private resolvePaidAt(raw: string | undefined, today: Date): Date {
    if (!raw) return today;
    const date = fromIsoDate(raw);
    if (!date) throw new BadRequestException(`La fecha de pago no es válida: ${raw}`);
    if (date > today) throw new BadRequestException('La fecha de pago no puede ser futura.');
    return date;
  }
}

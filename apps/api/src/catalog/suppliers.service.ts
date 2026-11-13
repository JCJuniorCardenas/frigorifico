import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, Supplier } from '../generated/prisma/client.js';
import { isValidCuit } from '../invoices/parser/cuit.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { mapCatalogError } from './catalog-errors.js';
import type { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto.js';

export interface SupplierView {
  id: string;
  name: string;
  cuit: string | null;
  phone: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

const MESSAGES = {
  unique: 'Ya existe un proveedor con ese CUIT',
  inUse: 'El proveedor tiene ingresos de mercadería y no se puede borrar. Podés desactivarlo.',
};

export function toSupplierView(supplier: Supplier): SupplierView {
  return {
    id: supplier.id,
    name: supplier.name,
    cuit: supplier.cuit,
    phone: supplier.phone,
    active: supplier.active,
    createdAt: supplier.createdAt.toISOString(),
    updatedAt: supplier.updatedAt.toISOString(),
  };
}

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(filter: { active?: boolean } = {}): Promise<SupplierView[]> {
    const suppliers = await this.prisma.supplier.findMany({
      where: filter.active === undefined ? {} : { active: filter.active },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    return suppliers.map(toSupplierView);
  }

  async create(dto: CreateSupplierDto): Promise<SupplierView> {
    if (dto.cuit) await this.assertCuitUsable(dto.cuit);
    try {
      const supplier = await this.prisma.supplier.create({
        data: { name: dto.name, cuit: dto.cuit ?? null, phone: dto.phone ?? null },
      });
      return toSupplierView(supplier);
    } catch (error) {
      throw mapCatalogError(error, MESSAGES);
    }
  }

  async update(id: string, dto: UpdateSupplierDto): Promise<SupplierView> {
    await this.findOrFail(id);
    if (dto.cuit) await this.assertCuitUsable(dto.cuit, id);
    // En los campos obligatorios, null se ignora; en los opcionales, null borra el dato.
    const data: Prisma.SupplierUpdateInput = {
      name: dto.name ?? undefined,
      active: dto.active ?? undefined,
      cuit: dto.cuit,
      phone: dto.phone,
    };
    try {
      return toSupplierView(await this.prisma.supplier.update({ where: { id }, data }));
    } catch (error) {
      throw mapCatalogError(error, MESSAGES);
    }
  }

  /** Borra un proveedor sin ingresos. Si tiene, la base lo impide y se responde 409. */
  async remove(id: string): Promise<void> {
    await this.findOrFail(id);
    try {
      await this.prisma.supplier.delete({ where: { id } });
    } catch (error) {
      throw mapCatalogError(error, MESSAGES);
    }
  }

  private async findOrFail(id: string): Promise<Supplier> {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw new NotFoundException('Proveedor no encontrado');
    return supplier;
  }

  private async assertCuitUsable(cuit: string, exceptId?: string): Promise<void> {
    if (!isValidCuit(cuit)) {
      throw new BadRequestException('El CUIT no es válido (revisá el dígito verificador)');
    }
    const existing = await this.prisma.supplier.findFirst({
      where: { cuit, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (existing) throw new ConflictException(MESSAGES.unique);
  }
}

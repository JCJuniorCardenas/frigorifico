import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, Product } from '../generated/prisma/client.js';
import type { ProductUnit } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { mapCatalogError } from './catalog-errors.js';
import type { CreateProductDto, UpdateProductDto } from './dto/product.dto.js';

/** Producto como lo ve el frontend: decimales como string, nunca number. */
export interface ProductView {
  id: string;
  name: string;
  category: string | null;
  unit: ProductUnit;
  salePrice: string | null;
  minStockKg: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

const MESSAGES = {
  unique: 'Ya existe un producto con ese nombre',
  inUse: 'El producto tiene movimientos de stock y no se puede borrar. Podés desactivarlo.',
};

export function toProductView(product: Product): ProductView {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    unit: product.unit,
    salePrice: product.salePrice?.toFixed(2) ?? null,
    minStockKg: product.minStockKg?.toFixed(3) ?? null,
    active: product.active,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(filter: { active?: boolean } = {}): Promise<ProductView[]> {
    const products = await this.prisma.product.findMany({
      where: filter.active === undefined ? {} : { active: filter.active },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    return products.map(toProductView);
  }

  async create(dto: CreateProductDto): Promise<ProductView> {
    await this.assertNameAvailable(dto.name);
    try {
      const product = await this.prisma.product.create({
        data: {
          name: dto.name,
          category: dto.category ?? null,
          unit: dto.unit ?? 'KG',
          salePrice: dto.salePrice ?? null,
          minStockKg: dto.minStockKg ?? null,
        },
      });
      return toProductView(product);
    } catch (error) {
      throw mapCatalogError(error, MESSAGES);
    }
  }

  async update(id: string, dto: UpdateProductDto): Promise<ProductView> {
    await this.findOrFail(id);
    if (dto.name) await this.assertNameAvailable(dto.name, id);

    // En los campos obligatorios, null se ignora; en los opcionales, null borra el dato.
    const data: Prisma.ProductUpdateInput = {
      name: dto.name ?? undefined,
      unit: dto.unit ?? undefined,
      active: dto.active ?? undefined,
      category: dto.category,
      salePrice: dto.salePrice,
      minStockKg: dto.minStockKg,
    };
    try {
      return toProductView(await this.prisma.product.update({ where: { id }, data }));
    } catch (error) {
      throw mapCatalogError(error, MESSAGES);
    }
  }

  /** Borra un producto sin movimientos. Si tiene, la base lo impide y se responde 409. */
  async remove(id: string): Promise<void> {
    await this.findOrFail(id);
    try {
      await this.prisma.product.delete({ where: { id } });
    } catch (error) {
      throw mapCatalogError(error, MESSAGES);
    }
  }

  private async findOrFail(id: string): Promise<Product> {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Producto no encontrado');
    return product;
  }

  /** "Asado" y "asado" serían el mismo corte: se compara sin distinguir mayúsculas. */
  private async assertNameAvailable(name: string, exceptId?: string): Promise<void> {
    const existing = await this.prisma.product.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (existing) throw new ConflictException(MESSAGES.unique);
  }
}

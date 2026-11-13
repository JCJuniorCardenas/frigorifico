import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ProductsService } from './products.service.js';
import { SuppliersService } from './suppliers.service.js';

const now = new Date('2026-11-13T12:00:00Z');
const storedProduct = {
  id: 'p1',
  name: 'Asado',
  category: 'vacuno',
  unit: 'KG' as const,
  salePrice: new Prisma.Decimal('8500.5'),
  minStockKg: new Prisma.Decimal('10'),
  active: true,
  createdAt: now,
  updatedAt: now,
};
const storedSupplier = {
  id: 's1',
  name: 'Frigorífico',
  cuit: '30714542431',
  phone: null,
  active: true,
  createdAt: now,
  updatedAt: now,
};

/** Error de clave foránea como lo lanza Prisma al borrar algo referenciado. */
const fkError = () =>
  new Prisma.PrismaClientKnownRequestError('Foreign key constraint violated', {
    code: 'P2003',
    clientVersion: 'test',
  });

function model(found: object | null, duplicate: object | null = null) {
  return {
    findUnique: vi.fn().mockResolvedValue(found),
    findFirst: vi.fn().mockResolvedValue(duplicate),
    findMany: vi.fn().mockResolvedValue(found ? [found] : []),
    create: vi
      .fn()
      .mockImplementation(({ data }: { data: object }) => Promise.resolve({ ...found, ...data })),
    update: vi
      .fn()
      .mockImplementation(({ data }: { data: object }) => Promise.resolve({ ...found, ...data })),
    delete: vi.fn().mockResolvedValue(found),
  };
}

function products(found: object | null = storedProduct, duplicate: object | null = null) {
  const prisma = { product: model(found, duplicate) };
  return { prisma, service: new ProductsService(prisma as unknown as PrismaService) };
}

function suppliers(found: object | null = storedSupplier, duplicate: object | null = null) {
  const prisma = { supplier: model(found, duplicate) };
  return { prisma, service: new SuppliersService(prisma as unknown as PrismaService) };
}

describe('ProductsService', () => {
  it('devuelve los decimales como string con escala fija, nunca number', async () => {
    const { service } = products();
    const [view] = await service.findAll();
    expect(view.salePrice).toBe('8500.50');
    expect(view.minStockKg).toBe('10.000');
  });

  it('crea con unidad KG por defecto', async () => {
    const { prisma, service } = products();
    await service.create({ name: 'Vacío' });
    expect(prisma.product.create.mock.calls[0][0].data).toMatchObject({
      name: 'Vacío',
      unit: 'KG',
      salePrice: null,
    });
  });

  it('rechaza un nombre repetido sin distinguir mayúsculas', async () => {
    const { prisma, service } = products(storedProduct, { id: 'otro' });
    await expect(service.create({ name: 'ASADO' })).rejects.toThrow(ConflictException);
    expect(prisma.product.findFirst.mock.calls[0][0].where).toMatchObject({
      name: { equals: 'ASADO', mode: 'insensitive' },
    });
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('al editar, null en el nombre se ignora y en el precio lo borra', async () => {
    const { prisma, service } = products();
    await service.update('p1', { name: null as unknown as string, salePrice: null });
    const data = prisma.product.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.name).toBeUndefined();
    expect(data.salePrice).toBeNull();
  });

  it('desactiva un producto', async () => {
    const { prisma, service } = products();
    const view = await service.update('p1', { active: false });
    expect(prisma.product.update.mock.calls[0][0].data).toMatchObject({ active: false });
    expect(view.active).toBe(false);
  });

  it('devuelve 404 si el producto no existe', async () => {
    const { service } = products(null);
    await expect(service.update('nope', { name: 'X' })).rejects.toThrow(NotFoundException);
    await expect(service.remove('nope')).rejects.toThrow(NotFoundException);
  });

  it('no borra un producto con movimientos: la clave foránea se traduce a 409', async () => {
    const { prisma, service } = products();
    prisma.product.delete.mockRejectedValue(fkError());
    await expect(service.remove('p1')).rejects.toThrow(
      new ConflictException(
        'El producto tiene movimientos de stock y no se puede borrar. Podés desactivarlo.',
      ),
    );
  });
});

describe('SuppliersService', () => {
  it('rechaza un CUIT con dígito verificador inválido', async () => {
    const { prisma, service } = suppliers();
    await expect(service.create({ name: 'X', cuit: '30714542430' })).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.supplier.create).not.toHaveBeenCalled();
  });

  it('rechaza un CUIT que ya tiene otro proveedor', async () => {
    const { service } = suppliers(storedSupplier, { id: 'otro' });
    await expect(service.create({ name: 'X', cuit: '30714542431' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('permite proveedores sin CUIT', async () => {
    const { prisma, service } = suppliers();
    await service.create({ name: 'Carnicería del barrio' });
    expect(prisma.supplier.findFirst).not.toHaveBeenCalled();
    expect(prisma.supplier.create.mock.calls[0][0].data).toMatchObject({ cuit: null });
  });

  it('no borra un proveedor con ingresos: la clave foránea se traduce a 409', async () => {
    const { prisma, service } = suppliers();
    prisma.supplier.delete.mockRejectedValue(fkError());
    await expect(service.remove('s1')).rejects.toThrow(ConflictException);
  });
});

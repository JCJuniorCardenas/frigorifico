import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { todayInArgentina } from '../src/invoices/due-dates.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

interface StockRow {
  productId: string;
  kg: string;
  avgCost: string;
  value: string;
  lowStock: boolean;
}

// Módulo 2, Fase 8: ingresos de mercadería y stock con costo promedio ponderado.
describe('Ingresos y stock (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const suffix = randomUUID().slice(0, 8);
  const adminEmail = `e2e-stock-admin-${suffix}@test.local`;
  const userEmail = `e2e-stock-user-${suffix}@test.local`;
  const password = 'clave-de-prueba-123';
  const today = todayInArgentina().toISOString().slice(0, 10);
  let admin: string[];
  let user: string[];
  let supplierId: string;
  const products: Record<'asado' | 'vacio' | 'matambre' | 'inactivo', string> = {
    asado: '',
    vacio: '',
    matambre: '',
    inactivo: '',
  };

  const http = () => request(app.getHttpServer());

  async function login(email: string): Promise<string[]> {
    const res = await http().post('/auth/login').send({ email, password }).expect(200);
    return res.get('Set-Cookie') ?? [];
  }

  function purchase(items: { productId: string; kg: string; costPerKg: string }[], extra = {}) {
    return http()
      .post('/purchases')
      .set('Cookie', user)
      .send({ date: today, supplierId, items, ...extra });
  }

  async function stockRow(productId: string): Promise<StockRow> {
    const res = await http().get('/stock').set('Cookie', user).expect(200);
    const row = (res.body.items as StockRow[]).find((r) => r.productId === productId);
    if (!row) throw new Error('El producto no aparece en el stock');
    return row;
  }

  async function sumOfMovements(productId: string): Promise<string> {
    const agg = await prisma.stockMovement.aggregate({ where: { productId }, _sum: { kg: true } });
    return (agg._sum.kg ?? new Prisma.Decimal(0)).toFixed(3);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    const passwordHash = await argon2.hash(password);
    await prisma.user.createMany({
      data: [
        { name: 'Admin Stock', email: adminEmail, role: 'ADMIN', passwordHash },
        { name: 'User Stock', email: userEmail, role: 'USER', passwordHash },
      ],
    });
    admin = await login(adminEmail);
    user = await login(userEmail);

    supplierId = (await prisma.supplier.create({ data: { name: `E2E Proveedor ${suffix}` } })).id;
    for (const key of Object.keys(products) as (keyof typeof products)[]) {
      const p = await prisma.product.create({
        data: {
          name: `E2E ${key} ${suffix}`,
          active: key !== 'inactivo',
          minStockKg: key === 'vacio' ? '20' : null,
        },
      });
      products[key] = p.id;
    }
  });

  afterAll(async () => {
    const ids = Object.values(products);
    await prisma.stockMovement.deleteMany({ where: { productId: { in: ids } } });
    await prisma.purchase.deleteMany({ where: { supplierId } });
    await prisma.product.deleteMany({ where: { id: { in: ids } } });
    await prisma.supplier.deleteMany({ where: { id: supplierId } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, userEmail] } } });
    await app.close();
  });

  it('sin sesión no se accede', async () => {
    await http().get('/stock').expect(401);
    await http().get('/purchases').expect(401);
    await http().post('/purchases').send({}).expect(401);
  });

  it('dos ingresos del mismo producto con distinto costo dan el promedio ponderado correcto', async () => {
    // 100 kg a $1.000 + 50 kg a $1.300 = $165.000 / 150 kg = $1.100 por kg.
    await purchase([{ productId: products.asado, kg: '100', costPerKg: '1000' }]).expect(201);
    expect(await stockRow(products.asado)).toMatchObject({
      kg: '100.000',
      avgCost: '1000.00',
      value: '100000.00',
    });

    await purchase([{ productId: products.asado, kg: '50', costPerKg: '1300' }]).expect(201);
    expect(await stockRow(products.asado)).toMatchObject({
      kg: '150.000',
      avgCost: '1100.00',
      value: '165000.00',
    });
    expect(await sumOfMovements(products.asado)).toBe('150.000');
  });

  it('un ingreso con varios ítems guarda totales exactos y un movimiento por ítem', async () => {
    const res = await purchase(
      [
        { productId: products.vacio, kg: '12.345', costPerKg: '1000.99' },
        { productId: products.matambre, kg: '8.5', costPerKg: '5200' },
      ],
      { herdNumber: '15005', notes: '  media res  ' },
    ).expect(201);
    expect(res.body).toMatchObject({
      herdNumber: '15005',
      notes: 'media res',
      itemCount: 2,
      totalKg: '20.845',
      totalCost: '56557.22', // 12.357,22 (12.345 × 1.000,99 redondeado) + 44.200,00
      createdBy: 'User Stock',
    });
    expect(res.body.items).toEqual([
      expect.objectContaining({ productId: products.vacio, kg: '12.345', totalCost: '12357.22' }),
      expect.objectContaining({ productId: products.matambre, kg: '8.500', totalCost: '44200.00' }),
    ]);

    const movements = await http()
      .get(`/stock/${products.vacio}/movements`)
      .set('Cookie', user)
      .expect(200);
    expect(movements.body).toEqual([
      expect.objectContaining({
        type: 'PURCHASE',
        kg: '12.345',
        unitCost: '1000.99',
        refType: 'Purchase',
        refId: res.body.id,
      }),
    ]);

    // Vacío tiene stock mínimo 20 kg: con 12,345 kg aparece la alerta.
    expect(await stockRow(products.vacio)).toMatchObject({ kg: '12.345', lowStock: true });
  });

  it('cargas simultáneas del mismo producto no pierden kilos ni calculan mal el promedio', async () => {
    // 5 ingresos de 10 kg a $1.000, $1.100, ..., $1.400 en paralelo: promedio $1.200 en cualquier orden.
    const costs = ['1000', '1100', '1200', '1300', '1400'];
    const results = await Promise.all(
      costs.map((costPerKg) => purchase([{ productId: products.matambre, kg: '10', costPerKg }])),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    // Antes había 8,5 kg a $5.200 (del test anterior): (44.200 + 60.000) / 58,5 = $1.781,20.
    expect(await stockRow(products.matambre)).toMatchObject({
      kg: '58.500',
      avgCost: '1781.20',
    });
    expect(await sumOfMovements(products.matambre)).toBe('58.500');
  });

  it('valida el ingreso y responde en español', async () => {
    const tomorrow = new Date(todayInArgentina().getTime() + 86_400_000).toISOString().slice(0, 10);
    const future = await purchase([{ productId: products.asado, kg: '1', costPerKg: '1' }], {
      date: tomorrow,
    }).expect(400);
    expect(future.body.message).toBe('La fecha del ingreso no puede ser futura');

    const zero = await purchase([{ productId: products.asado, kg: '0', costPerKg: '1000' }]).expect(
      400,
    );
    expect(zero.body.message).toContain('Ítem 1: los kg deben ser mayores a cero');

    const inactive = await purchase([
      { productId: products.inactivo, kg: '1', costPerKg: '1000' },
    ]).expect(400);
    expect(inactive.body.message).toContain('Productos inactivos');

    const badFormat = await purchase([
      { productId: products.asado, kg: '1,5', costPerKg: 1000 as unknown as string },
    ]).expect(400);
    expect(JSON.stringify(badFormat.body.message)).toContain('Los kg deben ser un número');

    await http()
      .post('/purchases')
      .set('Cookie', user)
      .send({ date: today, supplierId, items: [] })
      .expect(400);
  });

  it('lista con filtros, paginación y totales del filtro', async () => {
    const byHerd = await http().get('/purchases?herdNumber=15005').set('Cookie', user).expect(200);
    expect(byHerd.body).toMatchObject({ total: 1, totals: { kg: '20.845', cost: '56557.22' } });

    const bySupplier = await http()
      .get(`/purchases?supplierId=${supplierId}&pageSize=2&page=1`)
      .set('Cookie', user)
      .expect(200);
    expect(bySupplier.body.total).toBe(8);
    expect(bySupplier.body.items).toHaveLength(2);
    expect(bySupplier.body.items[0]).not.toHaveProperty('items');
  });

  it('no se pueden borrar productos ni proveedores con movimientos', async () => {
    await http().delete(`/products/${products.asado}`).set('Cookie', admin).expect(409);
    const res = await http().delete(`/suppliers/${supplierId}`).set('Cookie', admin).expect(409);
    expect(res.body.message).toContain('Podés desactivarlo');
  });

  it('el stock de cada producto es igual a la suma de sus movimientos', async () => {
    const res = await http().get('/stock').set('Cookie', user).expect(200);
    for (const key of ['asado', 'vacio', 'matambre'] as const) {
      const row = (res.body.items as StockRow[]).find((r) => r.productId === products[key]);
      expect(row?.kg).toBe(await sumOfMovements(products[key]));
    }
    // Los productos inactivos sin stock no aparecen.
    expect((res.body.items as StockRow[]).some((r) => r.productId === products.inactivo)).toBe(
      false,
    );
  });
});

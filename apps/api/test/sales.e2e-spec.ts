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
}

// Módulo 2, Fase 9: ventas de mostrador, advertencia de stock negativo y anulación.
describe('Ventas (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const suffix = randomUUID().slice(0, 8);
  const adminEmail = `e2e-sales-admin-${suffix}@test.local`;
  const userEmail = `e2e-sales-user-${suffix}@test.local`;
  const password = 'clave-de-prueba-123';
  const today = todayInArgentina().toISOString().slice(0, 10);
  let admin: string[];
  let user: string[];
  let supplierId: string;
  const products = { asado: '', sinStock: '', inactivo: '' };
  let firstSaleId: string;
  let negativeSaleId: string;

  const http = () => request(app.getHttpServer());

  async function login(email: string): Promise<string[]> {
    const res = await http().post('/auth/login').send({ email, password }).expect(200);
    return res.get('Set-Cookie') ?? [];
  }

  function sell(items: { productId: string; kg: string; pricePerKg: string }[], extra = {}) {
    return http()
      .post('/sales')
      .set('Cookie', user)
      .send({ items, paymentMethod: 'CASH', ...extra });
  }

  function buy(productId: string, kg: string, costPerKg: string) {
    return http()
      .post('/purchases')
      .set('Cookie', user)
      .send({ date: today, supplierId, items: [{ productId, kg, costPerKg }] })
      .expect(201);
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
        { name: 'Admin Ventas', email: adminEmail, role: 'ADMIN', passwordHash },
        { name: 'User Ventas', email: userEmail, role: 'USER', passwordHash },
      ],
    });
    admin = await login(adminEmail);
    user = await login(userEmail);

    supplierId = (await prisma.supplier.create({ data: { name: `E2E Ventas ${suffix}` } })).id;
    for (const key of Object.keys(products) as (keyof typeof products)[]) {
      const p = await prisma.product.create({
        data: { name: `E2E venta ${key} ${suffix}`, active: key !== 'inactivo' },
      });
      products[key] = p.id;
    }
    // Stock inicial: 100 kg a $1.000 + 50 kg a $1.300 = 150 kg a $1.100 promedio.
    await buy(products.asado, '100', '1000');
    await buy(products.asado, '50', '1300');
  });

  afterAll(async () => {
    const ids = Object.values(products);
    const users = await prisma.user.findMany({
      where: { email: { in: [adminEmail, userEmail] } },
      select: { id: true },
    });
    await prisma.sale.deleteMany({ where: { createdById: { in: users.map((u) => u.id) } } });
    await prisma.stockMovement.deleteMany({ where: { productId: { in: ids } } });
    await prisma.purchase.deleteMany({ where: { supplierId } });
    await prisma.product.deleteMany({ where: { id: { in: ids } } });
    await prisma.supplier.deleteMany({ where: { id: supplierId } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, userEmail] } } });
    await app.close();
  });

  it('sin sesión no se accede', async () => {
    await http().get('/sales').expect(401);
    await http().post('/sales').send({}).expect(401);
  });

  it('una venta descuenta stock y guarda el costo unitario vigente', async () => {
    const res = await sell(
      [
        { productId: products.asado, kg: '12.5', pricePerKg: '8500' },
        { productId: products.asado, kg: '2.345', pricePerKg: '9000' },
      ],
      { customerName: '  Juan  ', paymentMethod: 'TRANSFER' },
    ).expect(201);
    firstSaleId = res.body.id as string;
    expect(res.body).toMatchObject({
      date: today,
      customerName: 'Juan',
      paymentMethod: 'TRANSFER',
      total: '127355.00', // 106.250 + 21.105
      totalKg: '14.845',
      voided: false,
      createdBy: 'User Ventas',
    });
    expect(res.body.items).toEqual([
      expect.objectContaining({ kg: '12.500', subtotal: '106250.00', unitCost: '1100.00' }),
      expect.objectContaining({ kg: '2.345', subtotal: '21105.00', unitCost: '1100.00' }),
    ]);

    // Vender no cambia el costo promedio.
    expect(await stockRow(products.asado)).toMatchObject({ kg: '135.155', avgCost: '1100.00' });
    expect(await sumOfMovements(products.asado)).toBe('135.155');
    const movements = await prisma.stockMovement.findMany({
      where: { refType: 'Sale', refId: firstSaleId },
      orderBy: { kg: 'asc' },
    });
    expect(movements.map((m) => [m.type, m.kg.toFixed(3), m.unitCost?.toFixed(2)])).toEqual([
      ['SALE', '-12.500', '1100.00'],
      ['SALE', '-2.345', '1100.00'],
    ]);
  });

  it('si la venta deja stock negativo, advierte (409) y se puede confirmar', async () => {
    const items = [{ productId: products.sinStock, kg: '3', pricePerKg: '5000' }];
    const warn = await sell(items).expect(409);
    expect(warn.body).toMatchObject({
      code: 'NEGATIVE_STOCK',
      items: [
        {
          productId: products.sinStock,
          stockKg: '0.000',
          requestedKg: '3.000',
          resultingKg: '-3.000',
        },
      ],
    });
    expect(warn.body.message).toContain('quedaría con stock negativo');
    // La advertencia no registró nada.
    expect(await sumOfMovements(products.sinStock)).toBe('0.000');

    const confirmed = await sell(items, { confirmNegativeStock: true }).expect(201);
    negativeSaleId = confirmed.body.id as string;
    expect(confirmed.body.items[0]).toMatchObject({ unitCost: '0.00', subtotal: '15000.00' });
    expect(await stockRow(products.sinStock)).toMatchObject({ kg: '-3.000' });
  });

  it('anular es solo para ADMIN, exige motivo y restituye el stock exacto', async () => {
    await http()
      .post(`/sales/${firstSaleId}/void`)
      .set('Cookie', user)
      .send({ reason: 'error de carga' })
      .expect(403);
    const noReason = await http()
      .post(`/sales/${firstSaleId}/void`)
      .set('Cookie', admin)
      .send({})
      .expect(400);
    expect(JSON.stringify(noReason.body.message)).toContain('motivo');

    const res = await http()
      .post(`/sales/${firstSaleId}/void`)
      .set('Cookie', admin)
      .send({ reason: 'error de carga' })
      .expect(200);
    expect(res.body).toMatchObject({
      voided: true,
      voidedBy: 'Admin Ventas',
      voidReason: 'error de carga',
    });
    expect(await stockRow(products.asado)).toMatchObject({ kg: '150.000', avgCost: '1100.00' });
    expect(await sumOfMovements(products.asado)).toBe('150.000');
    const voids = await prisma.stockMovement.findMany({
      where: { refType: 'Sale', refId: firstSaleId, type: 'SALE_VOID' },
    });
    expect(voids.map((m) => m.kg.toFixed(3)).sort()).toEqual(['12.500', '2.345']);
    expect(voids[0].reason).toBe('Anulación de venta: error de carga');

    const again = await http()
      .post(`/sales/${firstSaleId}/void`)
      .set('Cookie', admin)
      .send({ reason: 'otra vez' })
      .expect(409);
    expect(again.body.message).toBe('La venta ya está anulada');
  });

  it('anular una venta sin costo (vendida sin stock) no altera el costo promedio', async () => {
    await http()
      .post(`/sales/${negativeSaleId}/void`)
      .set('Cookie', admin)
      .send({ reason: 'cliente no retiró' })
      .expect(200);
    expect(await stockRow(products.sinStock)).toMatchObject({ kg: '0.000', avgCost: '0.00' });
  });

  it('si entró mercadería a otro costo, la anulación repondera el promedio', async () => {
    // 150 kg a $1.100 → vendo 10 kg (costo $1.100) → 140 kg.
    const sale = await sell([{ productId: products.asado, kg: '10', pricePerKg: '9000' }]).expect(
      201,
    );
    // Entran 10 kg a $2.000: (140 × 1.100 + 10 × 2.000) / 150 = $1.160.
    await buy(products.asado, '10', '2000');
    expect(await stockRow(products.asado)).toMatchObject({ kg: '150.000', avgCost: '1160.00' });
    // Vuelven los 10 kg a $1.100: (150 × 1.160 + 10 × 1.100) / 160 = $1.156,25.
    await http()
      .post(`/sales/${sale.body.id}/void`)
      .set('Cookie', admin)
      .send({ reason: 'devolución' })
      .expect(200);
    expect(await stockRow(products.asado)).toMatchObject({ kg: '160.000', avgCost: '1156.25' });
    expect(await sumOfMovements(products.asado)).toBe('160.000');
  });

  it('valida la venta y responde en español', async () => {
    const tomorrow = new Date(todayInArgentina().getTime() + 86_400_000).toISOString().slice(0, 10);
    const future = await sell([{ productId: products.asado, kg: '1', pricePerKg: '1' }], {
      date: tomorrow,
    }).expect(400);
    expect(future.body.message).toBe('La fecha de la venta no puede ser futura');

    const zero = await sell([{ productId: products.asado, kg: '1', pricePerKg: '0' }]).expect(400);
    expect(zero.body.message).toContain('Ítem 1: el precio por kg debe ser mayor a cero');

    const inactive = await sell([
      { productId: products.inactivo, kg: '1', pricePerKg: '100' },
    ]).expect(400);
    expect(inactive.body.message).toContain('Productos inactivos');

    const badPayment = await sell([{ productId: products.asado, kg: '1', pricePerKg: '100' }], {
      paymentMethod: 'CHEQUE',
    }).expect(400);
    expect(JSON.stringify(badPayment.body.message)).toContain('La forma de pago');
  });

  it('el listado excluye las anuladas de los totales', async () => {
    const userIds = (
      await prisma.user.findMany({ where: { email: userEmail }, select: { id: true } })
    ).map((u) => u.id);
    const mine = await prisma.sale.count({ where: { createdById: { in: userIds } } });
    expect(mine).toBe(3);

    const active = await http()
      .get(`/sales?from=${today}&to=${today}`)
      .set('Cookie', user)
      .expect(200);
    const activeIds = (active.body.items as { id: string }[]).map((s) => s.id);
    expect(activeIds).not.toContain(firstSaleId);

    const voided = await http().get('/sales?status=voided').set('Cookie', user).expect(200);
    const voidedIds = (voided.body.items as { id: string }[]).map((s) => s.id);
    expect(voidedIds).toEqual(expect.arrayContaining([firstSaleId, negativeSaleId]));

    // Los totales de "todas" no suman las anuladas.
    const all = await http().get('/sales?status=all').set('Cookie', user).expect(200);
    const activeTotals = await http().get('/sales?status=active').set('Cookie', user).expect(200);
    expect(all.body.totals).toEqual(activeTotals.body.totals);
  });
});

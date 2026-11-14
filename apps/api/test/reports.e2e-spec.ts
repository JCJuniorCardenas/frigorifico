import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { monthRange, todayInArgentina } from '../src/invoices/due-dates.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

/**
 * Módulo 2, Fase 11: reportes. Los datos se cargan en marzo de 2020 para que el período no se
 * mezcle con otros datos de la base, y se comparan contra un cálculo hecho a mano:
 *
 * Compras: A 100 kg × $1.000 (02/03) + 50 kg × $1.300 (05/03) → costo promedio $1.100
 *          B  40 kg × $2.500,50 (02/03)                        → costo promedio $2.500,50
 * Ventas:
 *   S1 10/03 Efectivo:      A 10 kg × $2.000 = 20.000   (costo 11.000)
 *                           B 2,5 kg × $4.000 = 10.000  (costo 6.251,25)
 *   S2 10/03 Transferencia: A 5,25 kg × $2.100 = 11.025 (costo 5.775)
 *   S3 12/03 Tarjeta:       B 1,333 kg × $4.100 = 5.465,30 → ANULADA (no cuenta)
 *   S4 15/03 Efectivo:      A 0,75 kg × $1.999,99 = 1.499,99 (1.499,9925) (costo 825)
 *   Ventas = 42.524,99 · Costo = 23.851,25 · Ganancia = 18.673,74 · Margen = 43,91 %
 * Mermas 20/03: A 2 kg "Vencimiento" ($2.200), A 1 kg "Recorte" ($1.100),
 *               B 0,5 kg "Recorte" ($1.250,25) → 3,5 kg, $4.550,25; 3,5 / 190 kg = 1,84 %
 *               (+ un ajuste por conteo, que no es merma)
 */
describe('Reportes (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const suffix = randomUUID().slice(0, 8);
  const adminEmail = `e2e-rep-admin-${suffix}@test.local`;
  const password = 'clave-de-prueba-123';
  const range = 'from=2020-03-01&to=2020-03-31';
  let admin: string[];
  const supplierIds: string[] = [];
  const products = { a: '', b: '' };

  const http = () => request(app.getHttpServer());
  const get = (path: string) => http().get(path).set('Cookie', admin).expect(200);
  const post = (path: string, body: object) =>
    http().post(path).set('Cookie', admin).send(body).expect(201);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.user.create({
      data: {
        name: 'Admin Reportes',
        email: adminEmail,
        role: 'ADMIN',
        passwordHash: await argon2.hash(password),
      },
    });
    const res = await http().post('/auth/login').send({ email: adminEmail, password }).expect(200);
    admin = res.get('Set-Cookie') ?? [];

    for (const name of ['Hacienda Norte', 'Frigorífico Sur']) {
      supplierIds.push(
        (await prisma.supplier.create({ data: { name: `E2E ${name} ${suffix}` } })).id,
      );
    }
    products.a = (await prisma.product.create({ data: { name: `E2E rep A ${suffix}` } })).id;
    products.b = (await prisma.product.create({ data: { name: `E2E rep B ${suffix}` } })).id;
    const [north, south] = supplierIds;

    await post('/purchases', {
      date: '2020-03-02',
      supplierId: north,
      items: [
        { productId: products.a, kg: '100', costPerKg: '1000' },
        { productId: products.b, kg: '40', costPerKg: '2500.50' },
      ],
    });
    await post('/purchases', {
      date: '2020-03-05',
      supplierId: south,
      items: [{ productId: products.a, kg: '50', costPerKg: '1300' }],
    });

    const sale = (date: string, paymentMethod: string, items: object[]) =>
      post('/sales', { date, paymentMethod, items });
    await sale('2020-03-10', 'CASH', [
      { productId: products.a, kg: '10', pricePerKg: '2000' },
      { productId: products.b, kg: '2.5', pricePerKg: '4000' },
    ]);
    await sale('2020-03-10', 'TRANSFER', [
      { productId: products.a, kg: '5.25', pricePerKg: '2100' },
    ]);
    const voided = await sale('2020-03-12', 'CARD', [
      { productId: products.b, kg: '1.333', pricePerKg: '4100' },
    ]);
    await http()
      .post(`/sales/${voided.body.id}/void`)
      .set('Cookie', admin)
      .send({ reason: 'prueba' })
      .expect(200);
    await sale('2020-03-15', 'CASH', [
      { productId: products.a, kg: '0.75', pricePerKg: '1999.99' },
    ]);

    const waste = (productId: string, kg: string, reason: string) =>
      post('/stock/adjustments', { productId, type: 'WASTE', kg, reason, date: '2020-03-20' });
    await waste(products.a, '2', 'Vencimiento');
    await waste(products.a, '1', 'Recorte');
    await waste(products.b, '0.5', 'Recorte');
    await post('/stock/adjustments', {
      productId: products.b,
      type: 'ADJUSTMENT',
      kg: '-1',
      reason: 'Conteo físico',
      date: '2020-03-20',
    });
  });

  afterAll(async () => {
    const ids = Object.values(products);
    const user = await prisma.user.findUnique({ where: { email: adminEmail } });
    await prisma.sale.deleteMany({ where: { createdById: user?.id } });
    await prisma.stockMovement.deleteMany({ where: { productId: { in: ids } } });
    await prisma.purchase.deleteMany({ where: { supplierId: { in: supplierIds } } });
    await prisma.product.deleteMany({ where: { id: { in: ids } } });
    await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
    await prisma.user.deleteMany({ where: { email: adminEmail } });
    await app.close();
  });

  it('sin sesión no se accede', async () => {
    await http().get('/reports/dashboard').expect(401);
    await http().get(`/reports/sales?${range}&format=csv`).expect(401);
  });

  it('ganancia bruta = ventas − costo de lo vendido (cálculo manual)', async () => {
    const res = await get(`/reports/profit?${range}`);
    expect(res.body.period).toEqual({ from: '2020-03-01', to: '2020-03-31' });
    expect(res.body.totals).toEqual({
      kg: '18.500',
      revenue: '42524.99',
      cost: '23851.25',
      profit: '18673.74',
      marginPct: '43.91',
    });
    const byId = new Map(
      (res.body.byProduct as { productId: string }[]).map((r) => [r.productId, r]),
    );
    expect(byId.get(products.a)).toMatchObject({
      kg: '16.000',
      revenue: '32524.99',
      cost: '17600.00',
      profit: '14924.99',
      marginPct: '45.89',
    });
    expect(byId.get(products.b)).toMatchObject({
      kg: '2.500',
      revenue: '10000.00',
      cost: '6251.25',
      profit: '3748.75',
      marginPct: '37.49',
    });
  });

  it('ventas del período: totales y desglose por día, producto y forma de pago', async () => {
    const res = await get(`/reports/sales?${range}`);
    expect(res.body.totals).toEqual({
      count: 3,
      kg: '18.500',
      amount: '42524.99',
      averageTicket: '14175.00', // 42.524,99 / 3 = 14.174,996…
    });
    expect(res.body.byDay).toHaveLength(31);
    const day = (d: string) => (res.body.byDay as { date: string }[]).find((x) => x.date === d);
    expect(day('2020-03-10')).toEqual({
      date: '2020-03-10',
      count: 2,
      kg: '17.750',
      amount: '41025.00',
    });
    expect(day('2020-03-12')).toEqual({
      date: '2020-03-12',
      count: 0,
      kg: '0.000',
      amount: '0.00',
    });
    expect(day('2020-03-15')).toMatchObject({ count: 1, amount: '1499.99' });
    expect(res.body.byPaymentMethod).toEqual([
      { method: 'CASH', count: 2, amount: '31499.99' },
      { method: 'TRANSFER', count: 1, amount: '11025.00' },
      { method: 'CARD', count: 0, amount: '0.00' },
      { method: 'OTHER', count: 0, amount: '0.00' },
    ]);
    // La suma de cada desglose coincide con el total (en centavos, sin punto flotante).
    const sum = (rows: { amount: string }[]) =>
      rows.reduce((acc, r) => acc + BigInt(r.amount.replace('.', '')), 0n);
    expect(sum(res.body.byDay)).toBe(4252499n);
    expect(sum(res.body.byProduct)).toBe(4252499n);
  });

  it('mermas: kg, valor, % sobre lo comprado y desglose por motivo (sin los ajustes)', async () => {
    const res = await get(`/reports/waste?${range}`);
    expect(res.body.totals).toEqual({
      kg: '3.500',
      value: '4550.25',
      purchasedKg: '190.000',
      pctOfPurchased: '1.84',
    });
    expect(res.body.byReason).toEqual([
      { reason: 'Recorte', count: 2, kg: '1.500', value: '2350.25' },
      { reason: 'Vencimiento', count: 1, kg: '2.000', value: '2200.00' },
    ]);
    const a = (res.body.byProduct as { productId: string }[]).find(
      (r) => r.productId === products.a,
    );
    expect(a).toMatchObject({
      kg: '3.000',
      value: '3300.00',
      purchasedKg: '150.000',
      pctOfPurchased: '2.00',
    });
  });

  it('compras por proveedor y por producto', async () => {
    const res = await get(`/reports/purchases?${range}`);
    expect(res.body.totals).toEqual({ count: 2, kg: '190.000', amount: '265020.00' });
    expect(res.body.bySupplier).toEqual([
      expect.objectContaining({
        supplierId: supplierIds[0],
        count: 1,
        kg: '140.000',
        amount: '200020.00',
      }),
      expect.objectContaining({
        supplierId: supplierIds[1],
        count: 1,
        kg: '50.000',
        amount: '65000.00',
      }),
    ]);
    const a = (res.body.byProduct as { productId: string }[]).find(
      (r) => r.productId === products.a,
    );
    expect(a).toMatchObject({ kg: '150.000', amount: '165000.00', averageCost: '1100.00' });
  });

  it('stock valorizado coincide con la pantalla de stock', async () => {
    const [report, stock] = await Promise.all([get('/reports/stock'), get('/stock')]);
    expect(report.body).toEqual(stock.body);
    const a = (report.body.items as { productId: string }[]).find(
      (r) => r.productId === products.a,
    );
    // A: 150 − 16 vendidos − 3 de merma = 131 kg × $1.100.
    expect(a).toMatchObject({ kg: '131.000', avgCost: '1100.00', value: '144100.00' });
  });

  it('exporta a CSV para Excel (separador ";", coma decimal, fila de totales)', async () => {
    const res = await get(`/reports/profit?${range}&format=csv`);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="ganancia-product_2020-03-01_2020-03-31.csv"',
    );
    const lines = res.text.replace('﻿', '').trim().split('\r\n');
    expect(lines[0]).toBe(
      'Producto;Kg vendidos;Ventas;Costo de lo vendido;Ganancia bruta;Margen %',
    );
    expect(lines.at(-1)).toBe('TOTAL;18,500;42524,99;23851,25;18673,74;43,91');

    const byReason = await get(`/reports/waste?${range}&format=csv&section=reason`);
    expect(byReason.text).toContain('Vencimiento;1;2,000;2200,00');

    const bad = await http()
      .get(`/reports/sales?${range}&format=csv&section=nada`)
      .set('Cookie', admin)
      .expect(400);
    expect(bad.body.message).toContain('Opciones: day, product, payment');
  });

  it('el dashboard coincide con los listados', async () => {
    const today = todayInArgentina();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const month = monthRange(today);
    const [dash, salesToday, salesMonth, profitMonth, stock, invoices] = await Promise.all([
      get('/reports/dashboard'),
      get(`/sales?from=${iso(today)}&to=${iso(today)}`),
      get(`/sales?from=${iso(month.start)}&to=${iso(month.end)}`),
      get('/reports/profit'),
      get('/stock'),
      get('/invoices/summary'),
    ]);
    expect(dash.body.salesToday).toEqual({
      count: salesToday.body.totals.count,
      amount: salesToday.body.totals.amount,
    });
    expect(dash.body.salesMonth).toEqual({
      count: salesMonth.body.totals.count,
      amount: salesMonth.body.totals.amount,
    });
    expect(dash.body.profitMonth).toEqual({
      profit: profitMonth.body.totals.profit,
      marginPct: profitMonth.body.totals.marginPct,
    });
    expect(dash.body.stockValue).toBe(stock.body.totals.value);
    expect(dash.body.lowStockProducts).toBe(stock.body.totals.lowStock);
    expect(dash.body.invoices).toEqual({
      pending: invoices.body.pending,
      overdue: invoices.body.overdue,
    });
  });

  it('valida el período', async () => {
    const res = await http()
      .get('/reports/sales?from=2020-03-31&to=2020-03-01')
      .set('Cookie', admin)
      .expect(400);
    expect(res.body.message).toBe('La fecha "desde" es posterior a "hasta"');
  });
});

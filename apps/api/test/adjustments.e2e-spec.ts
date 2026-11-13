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

// Módulo 2, Fase 10: mermas y ajustes de stock con motivo obligatorio e historial.
describe('Mermas y ajustes (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const suffix = randomUUID().slice(0, 8);
  const userEmail = `e2e-adj-user-${suffix}@test.local`;
  const password = 'clave-de-prueba-123';
  const today = todayInArgentina().toISOString().slice(0, 10);
  let user: string[];
  let supplierId: string;
  let productId: string;
  let wasteId: string;

  const http = () => request(app.getHttpServer());

  function adjust(body: Record<string, unknown>) {
    return http()
      .post('/stock/adjustments')
      .set('Cookie', user)
      .send({ productId, ...body });
  }

  async function stockRow(): Promise<StockRow> {
    const res = await http().get('/stock').set('Cookie', user).expect(200);
    const row = (res.body.items as StockRow[]).find((r) => r.productId === productId);
    if (!row) throw new Error('El producto no aparece en el stock');
    return row;
  }

  async function sumOfMovements(): Promise<string> {
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

    await prisma.user.create({
      data: {
        name: 'User Ajustes',
        email: userEmail,
        role: 'USER',
        passwordHash: await argon2.hash(password),
      },
    });
    const res = await http().post('/auth/login').send({ email: userEmail, password }).expect(200);
    user = res.get('Set-Cookie') ?? [];

    supplierId = (await prisma.supplier.create({ data: { name: `E2E Ajustes ${suffix}` } })).id;
    productId = (await prisma.product.create({ data: { name: `E2E ajuste ${suffix}` } })).id;
    // Stock inicial: 50 kg a $2.000.
    await http()
      .post('/purchases')
      .set('Cookie', user)
      .send({ date: today, supplierId, items: [{ productId, kg: '50', costPerKg: '2000' }] })
      .expect(201);
  });

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { productId } });
    await prisma.purchase.deleteMany({ where: { supplierId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.supplier.deleteMany({ where: { id: supplierId } });
    await prisma.user.deleteMany({ where: { email: userEmail } });
    await app.close();
  });

  it('sin sesión no se accede', async () => {
    await http().get('/stock/adjustments').expect(401);
    await http().post('/stock/adjustments').send({}).expect(401);
  });

  it('una merma baja el stock, se valoriza al costo promedio y no lo cambia', async () => {
    const res = await adjust({ type: 'WASTE', kg: '2.5', reason: '  Vencimiento  ' }).expect(201);
    wasteId = res.body.id as string;
    expect(res.body).toMatchObject({
      type: 'WASTE',
      kg: '-2.500',
      unitCost: '2000.00',
      value: '-5000.00',
      reason: 'Vencimiento',
      stockBefore: '50.000',
      stockAfter: '47.500',
      createdBy: 'User Ajustes',
      date: today,
    });
    expect(await stockRow()).toMatchObject({ kg: '47.500', avgCost: '2000.00' });
    expect(await sumOfMovements()).toBe('47.500');
  });

  it('la merma aparece en el historial con el valor perdido', async () => {
    const res = await http()
      .get(`/stock/adjustments?type=WASTE&productId=${productId}`)
      .set('Cookie', user)
      .expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toMatchObject({ id: wasteId, kg: '-2.500', reason: 'Vencimiento' });
    expect(res.body.totals).toMatchObject({ wasteKg: '2.500', wasteValue: '5000.00' });
  });

  it('ajuste por conteo: la API calcula la diferencia con el stock', async () => {
    // Hay 47,5 kg; se cuentan 46,75 kg → ajuste de -0,750 kg.
    const res = await adjust({
      type: 'ADJUSTMENT',
      countedKg: '46.75',
      reason: 'Conteo físico',
    }).expect(201);
    expect(res.body).toMatchObject({
      kg: '-0.750',
      value: '-1500.00',
      stockBefore: '47.500',
      stockAfter: '46.750',
    });

    const same = await adjust({ type: 'ADJUSTMENT', countedKg: '46.750', reason: 'Conteo' }).expect(
      400,
    );
    expect(same.body.message).toContain('coincide con el stock');
  });

  it('ajuste con diferencia explícita (+ o -)', async () => {
    const res = await adjust({ type: 'ADJUSTMENT', kg: '+1.25', reason: 'Error de carga' }).expect(
      201,
    );
    expect(res.body).toMatchObject({ kg: '1.250', stockAfter: '48.000' });
    expect(await stockRow()).toMatchObject({ kg: '48.000', avgCost: '2000.00' });
  });

  it('una merma mayor al stock advierte (409) y se puede confirmar', async () => {
    const warn = await adjust({ type: 'WASTE', kg: '50', reason: 'Corte de luz' }).expect(409);
    expect(warn.body).toMatchObject({
      code: 'NEGATIVE_STOCK',
      items: [{ stockKg: '48.000', requestedKg: '50.000', resultingKg: '-2.000' }],
    });
    expect(await sumOfMovements()).toBe('48.000');

    await adjust({
      type: 'WASTE',
      kg: '50',
      reason: 'Corte de luz',
      confirmNegativeStock: true,
    }).expect(201);
    expect(await stockRow()).toMatchObject({ kg: '-2.000' });

    // Un conteo en cero lo vuelve a dejar exacto (ajuste positivo, sin advertencia).
    const zero = await adjust({
      type: 'ADJUSTMENT',
      countedKg: '0',
      reason: 'Conteo físico',
    }).expect(201);
    expect(zero.body).toMatchObject({ kg: '2.000', stockAfter: '0.000' });
    expect(await sumOfMovements()).toBe('0.000');
  });

  it('valida y responde en español', async () => {
    const noReason = await adjust({ type: 'WASTE', kg: '1' }).expect(400);
    expect(JSON.stringify(noReason.body.message)).toContain('El motivo es obligatorio');

    const shortReason = await adjust({ type: 'WASTE', kg: '1', reason: 'x' }).expect(400);
    expect(JSON.stringify(shortReason.body.message)).toContain('al menos 3 caracteres');

    const both = await adjust({
      type: 'ADJUSTMENT',
      kg: '1',
      countedKg: '2',
      reason: 'Conteo',
    }).expect(400);
    expect(both.body.message).toBe('Indicá los kg o los kg contados (uno de los dos)');

    const negativeWaste = await adjust({ type: 'WASTE', kg: '-1', reason: 'Rotura' }).expect(400);
    expect(negativeWaste.body.message).toBe('Los kg de la merma deben ser mayores a cero');

    const countedWaste = await adjust({ type: 'WASTE', countedKg: '1', reason: 'Rotura' }).expect(
      400,
    );
    expect(countedWaste.body.message).toContain('no un conteo');

    const badType = await adjust({ type: 'SALE', kg: '1', reason: 'Rotura' }).expect(400);
    expect(JSON.stringify(badType.body.message)).toContain('WASTE (merma) o ADJUSTMENT');
  });

  it('el historial lista mermas y ajustes con totales por tipo', async () => {
    const res = await http()
      .get(`/stock/adjustments?productId=${productId}`)
      .set('Cookie', user)
      .expect(200);
    expect(res.body.total).toBe(5);
    // Mermas: 2,5 + 50 = 52,5 kg a $2.000. Ajustes: -0,75 + 1,25 + 2 = +2,5 kg.
    expect(res.body.totals).toEqual({
      wasteKg: '52.500',
      wasteValue: '105000.00',
      adjustmentKg: '2.500',
      adjustmentValue: '5000.00',
    });
  });
});

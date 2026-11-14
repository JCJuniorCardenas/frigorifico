import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { todayInArgentina } from '../src/invoices/due-dates.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Módulo 2, Fase 12: vínculo opcional ingreso ↔ factura de faena por número de tropa.
describe('Vínculo ingreso ↔ factura de faena (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const suffix = randomUUID().slice(0, 8);
  const adminEmail = `e2e-link-admin-${suffix}@test.local`;
  const password = 'clave-de-prueba-123';
  const today = todayInArgentina().toISOString().slice(0, 10);
  // Tropas propias del test (9 dígitos al azar), para no chocar con otras facturas de la base.
  const herd = `9${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const otherHerd = `8${herd.slice(1)}`;
  let admin: string[];
  let supplierId: string;
  let productId: string;
  const invoiceIds: string[] = [];

  const http = () => request(app.getHttpServer());

  function purchase(extra: object) {
    return http()
      .post('/purchases')
      .set('Cookie', admin)
      .send({
        date: today,
        supplierId,
        items: [{ productId, kg: '10', costPerKg: '1000' }],
        ...extra,
      });
  }

  async function createInvoice(herdNumber: string, voucher: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
    const invoice = await prisma.invoice.create({
      data: {
        salesPoint: '00091',
        voucherNumber: voucher,
        issueDate: new Date('2026-11-12T00:00:00Z'),
        paymentDueDate: new Date('2026-11-12T00:00:00Z'),
        clientName: 'CLIENTE E2E SRL',
        clientCuit: '30714542431',
        herdNumber,
        slaughterKg: '811.00',
        totalAmount: '439211.86',
        netTaxedAmount: '348730.00',
        vat21Amount: '73233.30',
        exemptAmount: '17248.56',
        cae: '86462412597429',
        caeDueDate: new Date('2026-11-22T00:00:00Z'),
        pdfKey: `e2e/${randomUUID()}.pdf`,
        pdfHash: randomUUID(),
        uploadedById: user.id,
      },
    });
    invoiceIds.push(invoice.id);
    return invoice;
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
        name: 'Admin Vínculo',
        email: adminEmail,
        role: 'ADMIN',
        passwordHash: await argon2.hash(password),
      },
    });
    const res = await http().post('/auth/login').send({ email: adminEmail, password }).expect(200);
    admin = res.get('Set-Cookie') ?? [];
    supplierId = (await prisma.supplier.create({ data: { name: `E2E Vínculo ${suffix}` } })).id;
    productId = (await prisma.product.create({ data: { name: `E2E vínculo ${suffix}` } })).id;
  });

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { productId } });
    await prisma.purchase.deleteMany({ where: { supplierId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.supplier.deleteMany({ where: { id: supplierId } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.user.deleteMany({ where: { email: adminEmail } });
    await app.close();
  });

  it('sugiere las facturas de faena con la misma tropa', async () => {
    const invoice = await createInvoice(
      herd,
      `1${suffix.replace(/\D/g, '0').slice(0, 7)}`.slice(0, 8),
    );
    const res = await http()
      .get(`/purchases/invoice-candidates?herdNumber=${herd}`)
      .set('Cookie', admin)
      .expect(200);
    expect(res.body).toEqual([
      {
        id: invoice.id,
        salesPoint: '00091',
        voucherNumber: invoice.voucherNumber,
        issueDate: '2026-11-12',
        clientName: 'CLIENTE E2E SRL',
        herdNumber: herd,
        slaughterKg: '811.00',
        totalAmount: '439211.86',
        status: 'PENDING',
      },
    ]);
    const none = await http()
      .get(`/purchases/invoice-candidates?herdNumber=${otherHerd}`)
      .set('Cookie', admin)
      .expect(200);
    expect(none.body).toEqual([]);
    await http()
      .get('/purchases/invoice-candidates?herdNumber=abc')
      .set('Cookie', admin)
      .expect(400);
  });

  it('un ingreso con tropa se vincula a su factura y la muestra en el detalle', async () => {
    const [invoiceId] = invoiceIds;
    const res = await purchase({ herdNumber: herd, invoiceId }).expect(201);
    expect(res.body.invoice).toMatchObject({ id: invoiceId, herdNumber: herd, status: 'PENDING' });

    const detail = await http().get(`/purchases/${res.body.id}`).set('Cookie', admin).expect(200);
    expect(detail.body.invoice.id).toBe(invoiceId);
    const list = await http().get(`/purchases?herdNumber=${herd}`).set('Cookie', admin).expect(200);
    expect(list.body.items[0].invoice.id).toBe(invoiceId);
  });

  it('no vincula una factura de otra tropa', async () => {
    const res = await purchase({ herdNumber: otherHerd, invoiceId: invoiceIds[0] }).expect(400);
    expect(res.body.message).toContain(`es de la tropa ${herd}, no de la ${otherHerd}`);
  });

  it('sin tropa cargada, toma la de la factura vinculada', async () => {
    const res = await purchase({ invoiceId: invoiceIds[0] }).expect(201);
    expect(res.body.herdNumber).toBe(herd);
  });

  it('se puede vincular y desvincular después, sin tocar el stock', async () => {
    const created = await purchase({ herdNumber: herd }).expect(201);
    expect(created.body.invoice).toBeNull();
    const before = await prisma.stockMovement.count({ where: { productId } });

    const linked = await http()
      .patch(`/purchases/${created.body.id}/invoice`)
      .set('Cookie', admin)
      .send({ invoiceId: invoiceIds[0] })
      .expect(200);
    expect(linked.body.invoice.id).toBe(invoiceIds[0]);

    const unlinked = await http()
      .patch(`/purchases/${created.body.id}/invoice`)
      .set('Cookie', admin)
      .send({ invoiceId: null })
      .expect(200);
    expect(unlinked.body.invoice).toBeNull();
    expect(await prisma.stockMovement.count({ where: { productId } })).toBe(before);

    const missing = await http()
      .patch(`/purchases/${created.body.id}/invoice`)
      .set('Cookie', admin)
      .send({ invoiceId: randomUUID() })
      .expect(400);
    expect(missing.body.message).toBe('La factura de faena no existe');
  });

  it('si se elimina la factura, el ingreso queda sin vínculo (no se pierde)', async () => {
    const invoice = await createInvoice(
      otherHerd,
      `2${suffix.replace(/\D/g, '0').slice(0, 7)}`.slice(0, 8),
    );
    const created = await purchase({ herdNumber: otherHerd, invoiceId: invoice.id }).expect(201);
    await http().delete(`/invoices/${invoice.id}`).set('Cookie', admin).expect(204);
    const detail = await http()
      .get(`/purchases/${created.body.id}`)
      .set('Cookie', admin)
      .expect(200);
    expect(detail.body).toMatchObject({ herdNumber: otherHerd, invoice: null, itemCount: 1 });
  });
});

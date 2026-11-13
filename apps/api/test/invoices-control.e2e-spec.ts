import { createHash, randomInt, randomUUID } from 'node:crypto';
import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { addDays, todayInArgentina } from '../src/invoices/due-dates.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { StorageService } from '../src/storage/storage.service.js';
import { buildPdf } from './helpers/pdf.js';

const iso = (d: Date) => d.toISOString().slice(0, 10);

// Requiere la base levantada y migrada. Cada corrida usa un cliente con nombre único.
describe('Tabla de control, pagos y vencimientos (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storageDir: string;
  let adminCookies: string[];
  let userCookies: string[];
  const run = randomUUID().slice(0, 8);
  const clientName = `CLIENTE E2E ${run}`.toUpperCase();
  const clientCuit = '30500010912';
  const password = 'clave-de-prueba-123';
  const userIds: string[] = [];
  const today = todayInArgentina();
  const salesPoint = String(randomInt(10_000, 99_999));

  const http = () => request(app.getHttpServer());
  const as = (cookies: string[]) => ({
    get: (url: string) => http().get(url).set('Cookie', cookies),
    patch: (url: string) => http().patch(url).set('Cookie', cookies),
    post: (url: string) => http().post(url).set('Cookie', cookies),
    delete: (url: string) => http().delete(url).set('Cookie', cookies),
  });
  const list = (query: Record<string, string | number>) =>
    as(adminCookies)
      .get('/invoices')
      .query({ q: clientName, ...query })
      .expect(200);

  let seq = 0;
  async function createInvoice(opts: {
    dueInDays: number;
    total: string;
    kg?: string;
    status?: 'PENDING' | 'PAID';
    issueInDays?: number;
    withPdf?: boolean;
  }) {
    seq++;
    const pdf = buildPdf([[`Factura e2e ${run} ${seq}`]]);
    const pdfKey = `invoices/e2e/${run}-${seq}.pdf`;
    if (opts.withPdf) await app.get(StorageService).put(pdfKey, pdf);
    return prisma.invoice.create({
      data: {
        salesPoint,
        voucherNumber: String(seq).padStart(8, '0'),
        issueDate: addDays(today, opts.issueInDays ?? -10),
        paymentDueDate: addDays(today, opts.dueInDays),
        clientName,
        clientCuit,
        herdNumber: String(randomInt(100_000, 999_999)),
        slaughterKg: opts.kg ?? '100.00',
        totalAmount: opts.total,
        netTaxedAmount: opts.total,
        vat21Amount: '0',
        exemptAmount: '0',
        cae: '12345678901234',
        caeDueDate: addDays(today, 10),
        status: opts.status ?? 'PENDING',
        paidAt: opts.status === 'PAID' ? today : null,
        pdfKey,
        pdfHash: createHash('sha256').update(`${run}-${seq}`).digest('hex'),
        uploadedById: userIds[0],
      },
    });
  }

  async function login(email: string): Promise<string[]> {
    const res = await http().post('/auth/login').send({ email, password }).expect(200);
    return res.get('Set-Cookie') ?? [];
  }

  beforeAll(async () => {
    // Carpeta temporal definida en vitest.config.e2e.ts.
    storageDir = process.env.STORAGE_LOCAL_DIR!;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    const passwordHash = await argon2.hash(password);
    for (const role of ['ADMIN', 'USER'] as const) {
      const user = await prisma.user.create({
        data: {
          name: `${role} ${run}`,
          email: `e2e-${role.toLowerCase()}-${run}@test.local`,
          role,
          passwordHash,
        },
      });
      userIds.push(user.id);
    }
    adminCookies = await login(`e2e-admin-${run}@test.local`);
    userCookies = await login(`e2e-user-${run}@test.local`);
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { clientName } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
    await rm(storageDir, { recursive: true, force: true });
  });

  describe('listado', () => {
    beforeAll(async () => {
      await createInvoice({ dueInDays: -5, total: '1000.00', kg: '10.50' }); // vencida
      await createInvoice({ dueInDays: 2, total: '2000.00', kg: '20.25' }); // por vencer
      await createInvoice({ dueInDays: 20, total: '3000.00', kg: '30.00' }); // al día
      await createInvoice({ dueInDays: -30, total: '4000.00', status: 'PAID' }); // pagada
    });

    it('por defecto muestra pendientes, ordenadas por vencimiento más próximo', async () => {
      const res = await list({});
      expect(res.body.today).toBe(iso(today));
      expect(res.body.items.map((i: { totalAmount: string }) => i.totalAmount)).toEqual([
        '1000.00',
        '2000.00',
        '3000.00',
      ]);
      expect(res.body.items.map((i: { due: unknown }) => i.due)).toEqual([
        { state: 'overdue', daysToDue: -5 },
        { state: 'due_soon', daysToDue: 2 },
        { state: 'ok', daysToDue: 20 },
      ]);
      expect(res.body.totals).toEqual({ count: 3, kg: '60.75', amount: '6000.00' });
    });

    it('la pagada no tiene alerta de vencimiento aunque la fecha pasó', async () => {
      const res = await list({ status: 'paid' });
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].due).toEqual({ state: 'paid', daysToDue: null });
      expect(res.body.items[0].paidAt).toBe(iso(today));
    });

    it('filtra vencidas y todas', async () => {
      expect((await list({ status: 'overdue' })).body.totals.count).toBe(1);
      expect((await list({ status: 'all' })).body.totals).toMatchObject({
        count: 4,
        amount: '10000.00',
      });
    });

    it('pagina en el servidor con totales del filtro completo', async () => {
      const res = await list({ status: 'all', pageSize: 2, page: 2, sort: 'totalAmount' });
      expect(res.body.items.map((i: { totalAmount: string }) => i.totalAmount)).toEqual([
        '3000.00',
        '4000.00',
      ]);
      expect(res.body.totals.count).toBe(4);
    });

    it('ordena por cualquier columna', async () => {
      const res = await list({ status: 'all', sort: 'totalAmount', dir: 'desc' });
      expect(res.body.items[0].totalAmount).toBe('4000.00');
    });

    it('filtra por cliente y por rango de fechas de vencimiento', async () => {
      const byClient = await as(adminCookies)
        .get('/invoices')
        .query({ status: 'all', clientCuit, q: clientName })
        .expect(200);
      expect(byClient.body.totals.count).toBe(4);

      const res = await list({
        status: 'all',
        dateField: 'due',
        from: iso(addDays(today, 0)),
        to: iso(addDays(today, 30)),
      });
      expect(res.body.totals).toMatchObject({ count: 2, amount: '5000.00' });
    });

    it('rechaza parámetros inválidos', async () => {
      await as(adminCookies).get('/invoices').query({ pageSize: 1000 }).expect(400);
      await as(adminCookies).get('/invoices').query({ status: 'cualquiera' }).expect(400);
      await as(adminCookies).get('/invoices').query({ sort: 'passwordHash' }).expect(400);
      await as(adminCookies).get('/invoices').query({ from: '2026-02-31' }).expect(400);
    });

    it('sin sesión no se ven datos', async () => {
      await http().get('/invoices').expect(401);
      await http().get('/invoices/summary').expect(401);
    });
  });

  describe('pagos', () => {
    it('marcar pagada guarda fecha y usuario, saca la alerta y registra el cambio', async () => {
      const invoice = await createInvoice({ dueInDays: -3, total: '500.00' });

      const paid = await as(userCookies)
        .patch(`/invoices/${invoice.id}/status`)
        .send({ status: 'PAID' })
        .expect(200);
      expect(paid.body).toMatchObject({
        status: 'PAID',
        paidAt: iso(today),
        due: { state: 'paid', daysToDue: null },
      });

      const pendingIds = (await list({ status: 'pending', pageSize: 100 })).body.items.map(
        (i: { id: string }) => i.id,
      );
      expect(pendingIds).not.toContain(invoice.id);

      const reverted = await as(adminCookies)
        .patch(`/invoices/${invoice.id}/status`)
        .send({ status: 'PENDING' })
        .expect(200);
      expect(reverted.body).toMatchObject({
        status: 'PENDING',
        paidAt: null,
        due: { state: 'overdue', daysToDue: -3 },
      });

      const detail = await as(adminCookies).get(`/invoices/${invoice.id}`).expect(200);
      expect(detail.body.paidBy).toBeNull();
      expect(detail.body.statusLogs).toEqual([
        expect.objectContaining({
          fromStatus: 'PAID',
          toStatus: 'PENDING',
          changedBy: `ADMIN ${run}`,
        }),
        expect.objectContaining({
          fromStatus: 'PENDING',
          toStatus: 'PAID',
          changedBy: `USER ${run}`,
        }),
      ]);
    });

    it('acepta una fecha de pago pasada y rechaza una futura', async () => {
      const invoice = await createInvoice({ dueInDays: 5, total: '700.00' });
      await as(adminCookies)
        .patch(`/invoices/${invoice.id}/status`)
        .send({ status: 'PAID', paidAt: iso(addDays(today, 1)) })
        .expect(400);
      const res = await as(adminCookies)
        .patch(`/invoices/${invoice.id}/status`)
        .send({ status: 'PAID', paidAt: iso(addDays(today, -2)) })
        .expect(200);
      expect(res.body.paidAt).toBe(iso(addDays(today, -2)));
      const detail = await as(adminCookies).get(`/invoices/${invoice.id}`).expect(200);
      expect(detail.body.paidBy).toBe(`ADMIN ${run}`);
    });

    it('marcado masivo, idempotente y todo-o-nada', async () => {
      const a = await createInvoice({ dueInDays: 1, total: '100.00' });
      const b = await createInvoice({ dueInDays: 1, total: '200.00' });

      const first = await as(adminCookies)
        .post('/invoices/status/bulk')
        .send({ ids: [a.id, b.id], status: 'PAID' })
        .expect(200);
      expect(first.body.changed).toBe(2);
      expect(first.body.items.every((i: { status: string }) => i.status === 'PAID')).toBe(true);

      const again = await as(adminCookies)
        .post('/invoices/status/bulk')
        .send({ ids: [a.id, b.id], status: 'PAID' })
        .expect(200);
      expect(again.body.changed).toBe(0);

      await as(adminCookies)
        .post('/invoices/status/bulk')
        .send({ ids: [a.id, randomUUID()], status: 'PENDING' })
        .expect(404);
      const stillPaid = await prisma.invoice.findUniqueOrThrow({ where: { id: a.id } });
      expect(stillPaid.status).toBe('PAID');

      await as(adminCookies)
        .post('/invoices/status/bulk')
        .send({ ids: [], status: 'PAID' })
        .expect(400);
    });
  });

  it('las tarjetas de resumen coinciden con la suma de las filas', async () => {
    const summary = (await as(adminCookies).get('/invoices/summary').expect(200)).body;
    const totals = async (query: Record<string, string>) =>
      (await as(adminCookies).get('/invoices').query(query).expect(200)).body.totals;

    const pending = await totals({ status: 'pending' });
    const overdue = await totals({ status: 'overdue' });
    const week = await totals({
      status: 'pending',
      dateField: 'due',
      from: iso(today),
      to: iso(addDays(today, 7)),
    });
    expect(summary.today).toBe(iso(today));
    expect(summary.pending).toEqual({ count: pending.count, amount: pending.amount });
    expect(summary.overdue).toEqual({ count: overdue.count, amount: overdue.amount });
    expect(summary.dueThisWeek).toEqual({ count: week.count, amount: week.amount });
    expect(summary.collectedThisMonth.count).toBeGreaterThanOrEqual(1);
  });

  it('lista los clientes para el filtro', async () => {
    const res = await as(adminCookies).get('/invoices/clients').expect(200);
    expect(res.body).toContainEqual({ clientCuit, clientName: expect.any(String) });
  });

  describe('PDF, edición y borrado', () => {
    it('sirve el PDF solo con sesión', async () => {
      const invoice = await createInvoice({ dueInDays: 3, total: '10.00', withPdf: true });
      const res = await as(userCookies).get(`/invoices/${invoice.id}/pdf`).expect(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toContain(
        `factura-${salesPoint}-${invoice.voucherNumber}.pdf`,
      );
      expect(
        Buffer.from(res.body as Buffer)
          .subarray(0, 5)
          .toString(),
      ).toBe('%PDF-');
      await http().get(`/invoices/${invoice.id}/pdf`).expect(401);

      const noFile = await createInvoice({ dueInDays: 3, total: '10.00' });
      await as(userCookies).get(`/invoices/${noFile.id}/pdf`).expect(404);
    });

    it('edita datos y avisa si el comprobante choca con otra factura', async () => {
      const a = await createInvoice({ dueInDays: 3, total: '10.00' });
      const b = await createInvoice({ dueInDays: 3, total: '10.00' });
      const res = await as(userCookies)
        .patch(`/invoices/${a.id}`)
        .send({ totalAmount: '12.50', paymentDueDate: iso(addDays(today, 9)), needsReview: false })
        .expect(200);
      expect(res.body).toMatchObject({
        totalAmount: '12.50',
        paymentDueDate: iso(addDays(today, 9)),
        needsReview: false,
        due: { state: 'ok', daysToDue: 9 },
      });
      await as(userCookies)
        .patch(`/invoices/${a.id}`)
        .send({ voucherNumber: b.voucherNumber })
        .expect(409);
      await as(userCookies).patch(`/invoices/${a.id}`).send({ totalAmount: '1,5' }).expect(400);
    });

    it('solo un ADMIN puede borrar, y se borra también el PDF', async () => {
      const invoice = await createInvoice({ dueInDays: 3, total: '10.00', withPdf: true });
      await as(userCookies).delete(`/invoices/${invoice.id}`).expect(403);
      await as(adminCookies).delete(`/invoices/${invoice.id}`).expect(204);
      await as(adminCookies).get(`/invoices/${invoice.id}`).expect(404);
      await expect(stat(join(storageDir, invoice.pdfKey))).rejects.toThrow();
      await as(adminCookies).delete(`/invoices/${invoice.id}`).expect(404);
    });
  });
});

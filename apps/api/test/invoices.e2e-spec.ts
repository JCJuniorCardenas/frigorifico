import { randomInt, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { buildFakeInvoicePdf, buildPdf } from './helpers/pdf.js';

// Requiere la base levantada y migrada: `pnpm db:up` y `pnpm --filter api db:migrate`.
describe('Carga de facturas (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storageDir: string;
  let cookies: string[];
  const email = `e2e-invoices-${randomUUID().slice(0, 8)}@test.local`;
  const password = 'clave-de-prueba-123';
  let userId: string;

  // Números de comprobante y tropa al azar para no chocar con datos de otras corridas.
  const voucher = () => String(randomInt(10_000_000, 99_999_999));
  const herd = () => String(randomInt(900_000, 999_999));

  const parse = (pdf: Buffer, filename = 'factura.pdf', contentType = 'application/pdf') =>
    request(app.getHttpServer())
      .post('/invoices/parse')
      .set('Cookie', cookies)
      .attach('file', pdf, { filename, contentType });

  const create = (pdf: Buffer, data: unknown) =>
    request(app.getHttpServer())
      .post('/invoices')
      .set('Cookie', cookies)
      .field('data', JSON.stringify(data))
      .attach('file', pdf, { filename: 'factura.pdf', contentType: 'application/pdf' });

  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'frigorifico-e2e-'));
    process.env.STORAGE_LOCAL_DIR = storageDir;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    const user = await prisma.user.create({
      data: { name: 'Carga E2E', email, passwordHash: await argon2.hash(password) },
    });
    userId = user.id;
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    cookies = res.get('Set-Cookie') ?? [];
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { uploadedById: userId } });
    await prisma.user.delete({ where: { id: userId } });
    await app.close();
    await rm(storageDir, { recursive: true, force: true });
  });

  it('sin sesión no se puede subir', async () => {
    await request(app.getHttpServer())
      .post('/invoices/parse')
      .attach('file', buildFakeInvoicePdf({ voucherNumber: voucher() }), 'factura.pdf')
      .expect(401);
  });

  it('subir el mismo PDF dos veces devuelve 409', async () => {
    const voucherNumber = voucher();
    const pdf = buildFakeInvoicePdf({ voucherNumber, herdNumber: herd() });

    const parsed = await parse(pdf).expect(200);
    expect(parsed.body.draft).toMatchObject({
      salesPoint: '00099',
      voucherNumber,
      clientName: 'CLIENTE DE PRUEBA SA',
      clientCuit: '30500010912',
      slaughterKg: '811.00',
      totalAmount: '439211.86',
      issueDate: '2026-11-12',
      paymentDueDate: '2026-11-20',
    });
    expect(parsed.body.fileHash).toMatch(/^[0-9a-f]{64}$/);

    const created = await create(pdf, parsed.body.draft).expect(201);
    expect(created.body).toMatchObject({
      voucherNumber,
      status: 'PENDING',
      totalAmount: '439211.86',
      paymentDueDate: '2026-11-20',
    });
    expect(created.body).not.toHaveProperty('pdfKey');

    // El PDF quedó guardado en el storage.
    const stored = await prisma.invoice.findUniqueOrThrow({ where: { id: created.body.id } });
    const yearDir = join(storageDir, 'invoices', '2026');
    expect(await readdir(yearDir)).toContain(stored.pdfKey.split('/').at(-1));

    const again = await parse(pdf).expect(409);
    expect(again.body.duplicate).toMatchObject({ id: created.body.id, reason: 'SAME_FILE' });
    expect(again.body.message).toContain(`00099-${voucherNumber}`);

    await create(pdf, parsed.body.draft).expect(409);
  });

  it('otro PDF con el mismo comprobante también es duplicado', async () => {
    const voucherNumber = voucher();
    const first = buildFakeInvoicePdf({ voucherNumber, herdNumber: herd() });
    const parsed = await parse(first).expect(200);
    await create(first, parsed.body.draft).expect(201);

    const reprint = buildFakeInvoicePdf({ voucherNumber, salt: 'reimpresion' });
    const res = await parse(reprint).expect(409);
    expect(res.body.duplicate.reason).toBe('SAME_VOUCHER');
  });

  it('avisa (sin bloquear) si la tropa ya está en otra factura', async () => {
    const herdNumber = herd();
    const first = buildFakeInvoicePdf({ voucherNumber: voucher(), herdNumber });
    const parsed = await parse(first).expect(200);
    await create(first, parsed.body.draft).expect(201);

    const second = buildFakeInvoicePdf({ voucherNumber: voucher(), herdNumber });
    const res = await parse(second).expect(200);
    expect(res.body.needsReview).toBe(true);
    expect(res.body.warnings).toContainEqual(
      expect.objectContaining({ code: 'HERD_DUPLICATE', field: 'herdNumber' }),
    );

    const created = await create(second, res.body.draft).expect(201);
    expect(created.body.needsReview).toBe(true);
  });

  it('guarda los valores corregidos en la revisión', async () => {
    const pdf = buildFakeInvoicePdf({ voucherNumber: voucher(), herdNumber: herd() });
    const parsed = await parse(pdf).expect(200);
    const created = await create(pdf, {
      ...parsed.body.draft,
      clientName: 'NOMBRE CORREGIDO SRL',
      paymentDueDate: '2026-12-01',
    }).expect(201);
    expect(created.body).toMatchObject({
      clientName: 'NOMBRE CORREGIDO SRL',
      paymentDueDate: '2026-12-01',
    });
  });

  it('valida los datos confirmados y responde en español', async () => {
    const pdf = buildFakeInvoicePdf({ voucherNumber: voucher() });
    const parsed = await parse(pdf).expect(200);
    const res = await create(pdf, {
      ...parsed.body.draft,
      totalAmount: '439.211,86',
      clientCuit: '123',
      issueDate: '2026-02-31',
    }).expect(400);
    const message = JSON.stringify(res.body.message);
    expect(message).toContain('El importe total');
    expect(message).toContain('CUIT del cliente');

    const badDate = await create(pdf, { ...parsed.body.draft, issueDate: '2026-02-31' }).expect(
      400,
    );
    expect(badDate.body.message).toContain('no es una fecha válida');

    await create(pdf, { ...parsed.body.draft, extra: 'campo' }).expect(400);
    await request(app.getHttpServer())
      .post('/invoices')
      .set('Cookie', cookies)
      .attach('file', pdf, { filename: 'factura.pdf', contentType: 'application/pdf' })
      .expect(400);
  });

  it('rechaza archivos que no son PDF', async () => {
    const html = Buffer.from('<html>hola</html>');
    const res = await parse(html, 'factura.pdf').expect(400);
    expect(res.body.message).toContain('firma %PDF');

    await parse(
      buildFakeInvoicePdf({ voucherNumber: voucher() }),
      'factura.txt',
      'text/plain',
    ).expect(400);
    await request(app.getHttpServer()).post('/invoices/parse').set('Cookie', cookies).expect(400);
  });

  it('rechaza archivos de más de 5 MB con mensaje en español', async () => {
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(5 * 1024 * 1024 + 10)]);
    const res = await parse(big).expect(413);
    expect(res.body.message).toBe('El archivo supera el máximo de 5 MB.');
  });

  it('responde 422 si el PDF no es una factura', async () => {
    const res = await parse(buildPdf([['Presupuesto', 'Total estimado: 1000']])).expect(422);
    expect(res.body.code).toBe('NOT_AN_INVOICE');
  });

  it('devuelve el detalle de una factura y 404 si no existe', async () => {
    const pdf = buildFakeInvoicePdf({ voucherNumber: voucher(), herdNumber: herd() });
    const parsed = await parse(pdf).expect(200);
    const created = await create(pdf, parsed.body.draft).expect(201);
    await request(app.getHttpServer())
      .get(`/invoices/${created.body.id}`)
      .set('Cookie', cookies)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/invoices/${randomUUID()}`)
      .set('Cookie', cookies)
      .expect(404);
  });

  // El PDF real no se versiona (ver fixtures/README.md); si está, se prueba también.
  const fixture = resolve(
    import.meta.dirname,
    '../../../fixtures/27252783119_001_00004_00000115.pdf',
  );
  it.skipIf(!existsSync(fixture))('lee el PDF de ejemplo real', async () => {
    const res = await parse(readFileSync(fixture));
    // 409 si ya se cargó en la base de desarrollo desde la web.
    expect([200, 409]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.draft).toMatchObject({
        clientName: 'LA BELGRANO SRL',
        herdNumber: '15005',
        slaughterKg: '811.00',
        totalAmount: '439211.86',
        paymentDueDate: '2026-11-12',
      });
    }
  });
});

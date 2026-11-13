// Facturas de PRUEBA con datos ficticios, para probar la tabla con volumen (solo desarrollo).
// Uso:  pnpm --filter api db:seed-demo [cantidad]   (por defecto 500)
//       pnpm --filter api db:clear-demo             (borra solo las de prueba)
// Se reconocen por el punto de venta 00090 y la carpeta "demo/" del storage.
import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { LocalStorageService } from '../src/storage/local-storage.service.js';
import { addDays, todayInArgentina } from '../src/invoices/due-dates.js';
import { buildPdf } from '../test/helpers/pdf.js';

const DEMO_SALES_POINT = '00090';

if (process.env.NODE_ENV === 'production') {
  console.error('El seed de prueba no se corre en producción.');
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const storage = new LocalStorageService(process.env.STORAGE_LOCAL_DIR ?? './storage');

/** CUIT ficticio con dígito verificador válido. */
function fakeCuit(prefix: string, body: number): string {
  const base = `${prefix}${String(body).padStart(8, '0')}`;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(base[i]), 0);
  const check = 11 - (sum % 11);
  if (check === 10) return fakeCuit(prefix, body + 1);
  return `${base}${check === 11 ? 0 : check}`;
}

const CLIENTS = [
  'CARNICERÍA DEMO UNO SRL',
  'SUPERMERCADO DEMO DOS SA',
  'FRIGORÍFICO DEMO TRES SRL',
  'CARNES DEMO CUATRO SA',
  'DISTRIBUIDORA DEMO CINCO SRL',
  'CARNICERÍA DEMO SEIS',
  'MAYORISTA DEMO SIETE SA',
  'AUTOSERVICIO DEMO OCHO SRL',
].map((name, i) => ({ name, cuit: fakeCuit('30', 71000000 + i * 1111) }));

/** Generador pseudoaleatorio con semilla, para que el seed sea reproducible. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

async function clear(): Promise<void> {
  const demo = await prisma.invoice.findMany({
    where: { salesPoint: DEMO_SALES_POINT, pdfKey: { startsWith: 'demo/' } },
    select: { id: true, pdfKey: true },
  });
  await prisma.invoice.deleteMany({ where: { id: { in: demo.map((d) => d.id) } } });
  await Promise.all(demo.map((d) => storage.delete(d.pdfKey)));
  console.log(`Borradas ${demo.length} facturas de prueba.`);
}

async function seed(count: number): Promise<void> {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (!admin) throw new Error('Primero creá el ADMIN con `pnpm --filter api db:seed`.');

  await clear();
  const random = rng(42);
  const today = todayInArgentina();

  for (let i = 0; i < count; i++) {
    const client = CLIENTS[Math.floor(random() * CLIENTS.length)];
    const issueDate = addDays(today, -Math.floor(random() * 120));
    const paymentDueDate = addDays(issueDate, [0, 7, 15, 30][Math.floor(random() * 4)]);
    const kgCents = BigInt(Math.floor(30_000 + random() * 120_000)); // 300 a 1500 kg
    const net = kgCents * 430n; // centavos: (kg × 100) × $430 = (kg × $430) × 100
    const vat = (net * 21n) / 100n;
    const exempt = BigInt(Math.floor(random() * 2_000_000));
    const total = net + vat + exempt;
    const paid = paymentDueDate < today ? random() < 0.6 : random() < 0.15;
    const voucherNumber = String(i + 1).padStart(8, '0');

    const pdf = buildPdf([
      [
        'FACTURA DE PRUEBA (datos ficticios)',
        `Punto de Venta: ${DEMO_SALES_POINT} Comp. Nro: ${voucherNumber}`,
        `Cliente: ${client.name}`,
      ],
    ]);
    const pdfKey = `demo/${randomUUID()}.pdf`;
    await storage.put(pdfKey, pdf);

    const money = (cents: bigint) => `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
    await prisma.invoice.create({
      data: {
        salesPoint: DEMO_SALES_POINT,
        voucherNumber,
        issueDate,
        paymentDueDate,
        clientName: client.name,
        clientCuit: client.cuit,
        herdNumber: String(20000 + i),
        slaughterKg: money(kgCents),
        totalAmount: money(total),
        netTaxedAmount: money(net),
        vat21Amount: money(vat),
        exemptAmount: money(exempt),
        cae: String(10_000_000_000_000 + i),
        caeDueDate: addDays(issueDate, 10),
        status: paid ? 'PAID' : 'PENDING',
        paidAt: paid ? (paymentDueDate < today ? paymentDueDate : today) : null,
        paidById: paid ? admin.id : null,
        pdfKey,
        pdfHash: createHash('sha256').update(pdf).digest('hex'),
        uploadedById: admin.id,
      },
    });
  }
  console.log(`Creadas ${count} facturas de prueba (punto de venta ${DEMO_SALES_POINT}).`);
}

try {
  if (process.argv.includes('--clear')) {
    await clear();
  } else {
    const count = Number(process.argv[2] ?? 500);
    if (!Number.isInteger(count) || count < 1 || count > 10_000) {
      throw new Error('La cantidad debe ser un entero entre 1 y 10000.');
    }
    await seed(count);
  }
} finally {
  await prisma.$disconnect();
}

// Crea el primer ADMIN si no existe ningún usuario ADMIN.
// Uso: pnpm --filter api db:seed  (lee SEED_ADMIN_* de .env)
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import argon2 from 'argon2';
import { PrismaClient } from '../src/generated/prisma/client.js';

const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD;
const name = process.env.SEED_ADMIN_NAME?.trim() || 'Administrador';

if (!email || !password) {
  console.error('Faltan SEED_ADMIN_EMAIL y/o SEED_ADMIN_PASSWORD en .env');
  process.exit(1);
}
if (password.length < 8) {
  console.error('SEED_ADMIN_PASSWORD debe tener al menos 8 caracteres');
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

try {
  const existingAdmin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (existingAdmin) {
    console.log(`Ya existe un ADMIN (${existingAdmin.email}); no se crea otro.`);
  } else {
    const user = await prisma.user.create({
      data: { name, email, role: 'ADMIN', passwordHash: await argon2.hash(password) },
    });
    console.log(`ADMIN creado: ${user.email}`);
  }
} finally {
  await prisma.$disconnect();
}

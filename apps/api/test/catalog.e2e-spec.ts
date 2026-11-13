import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Módulo 2, Fase 7: catálogo de productos y proveedores.
describe('Catálogo (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const suffix = randomUUID().slice(0, 8);
  const adminEmail = `e2e-cat-admin-${suffix}@test.local`;
  const userEmail = `e2e-cat-user-${suffix}@test.local`;
  const password = 'clave-de-prueba-123';
  const name = (label: string) => `E2E ${label} ${suffix}`;
  // Tabla auxiliar que simula un movimiento de stock apuntando a un producto (las tablas reales
  // de movimientos llegan en la Fase 8, con la misma restricción de clave foránea).
  const probeTable = `e2e_fk_probe_${suffix}`;
  let admin: string[];
  let user: string[];

  async function login(email: string): Promise<string[]> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return res.get('Set-Cookie') ?? [];
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
        { name: 'Admin Catálogo', email: adminEmail, role: 'ADMIN', passwordHash },
        { name: 'User Catálogo', email: userEmail, role: 'USER', passwordHash },
      ],
    });
    admin = await login(adminEmail);
    user = await login(userEmail);
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`drop table if exists "${probeTable}"`);
    await prisma.product.deleteMany({ where: { name: { contains: suffix } } });
    await prisma.supplier.deleteMany({ where: { name: { contains: suffix } } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, userEmail] } } });
    await app.close();
  });

  it('sin sesión no se accede al catálogo', async () => {
    await request(app.getHttpServer()).get('/products').expect(401);
    await request(app.getHttpServer()).get('/suppliers').expect(401);
  });

  describe('productos', () => {
    it('un USER crea, edita y desactiva un producto', async () => {
      const created = await request(app.getHttpServer())
        .post('/products')
        .set('Cookie', user)
        .send({
          name: `  ${name('Asado')}  `,
          category: 'vacuno',
          salePrice: '8500.5',
          minStockKg: '12.5',
        })
        .expect(201);
      expect(created.body).toMatchObject({
        name: name('Asado'),
        category: 'vacuno',
        unit: 'KG',
        salePrice: '8500.50',
        minStockKg: '12.500',
        active: true,
      });

      const id = created.body.id as string;
      const edited = await request(app.getHttpServer())
        .patch(`/products/${id}`)
        .set('Cookie', user)
        .send({ salePrice: '9000', category: '' })
        .expect(200);
      expect(edited.body).toMatchObject({ salePrice: '9000.00', category: null });

      await request(app.getHttpServer())
        .patch(`/products/${id}`)
        .set('Cookie', user)
        .send({ active: false })
        .expect(200);

      const onlyActive = await request(app.getHttpServer())
        .get('/products?active=true')
        .set('Cookie', user)
        .expect(200);
      expect((onlyActive.body as { id: string }[]).some((p) => p.id === id)).toBe(false);
      const all = await request(app.getHttpServer())
        .get('/products')
        .set('Cookie', user)
        .expect(200);
      expect(all.body).toContainEqual(expect.objectContaining({ id, active: false }));
    });

    it('no permite dos productos con el mismo nombre (sin distinguir mayúsculas)', async () => {
      await request(app.getHttpServer())
        .post('/products')
        .set('Cookie', user)
        .send({ name: name('Vacío') })
        .expect(201);
      const res = await request(app.getHttpServer())
        .post('/products')
        .set('Cookie', user)
        .send({ name: name('Vacío').toUpperCase() })
        .expect(409);
      expect(res.body.message).toBe('Ya existe un producto con ese nombre');
    });

    it('valida precios y kilos como decimales y responde en español', async () => {
      const res = await request(app.getHttpServer())
        .post('/products')
        .set('Cookie', user)
        .send({ name: name('Malo'), salePrice: 8500.5, minStockKg: '1,5', unit: 'LITRO' })
        .expect(400);
      const messages = JSON.stringify(res.body.message);
      expect(messages).toContain('El precio sugerido debe ser un número');
      expect(messages).toContain('El stock mínimo debe ser un número');
      expect(messages).toContain('La unidad debe ser KG o UNIT');
    });

    it('borrar es solo para ADMIN', async () => {
      const created = await request(app.getHttpServer())
        .post('/products')
        .set('Cookie', user)
        .send({ name: name('Para borrar') })
        .expect(201);
      const id = created.body.id as string;
      await request(app.getHttpServer()).delete(`/products/${id}`).set('Cookie', user).expect(403);
      await request(app.getHttpServer()).delete(`/products/${id}`).set('Cookie', admin).expect(204);
      await request(app.getHttpServer()).delete(`/products/${id}`).set('Cookie', admin).expect(404);
    });

    it('no se puede borrar un producto con movimientos: la base lo impide y se responde 409', async () => {
      const created = await request(app.getHttpServer())
        .post('/products')
        .set('Cookie', user)
        .send({ name: name('Con movimientos') })
        .expect(201);
      const id = created.body.id as string;
      await prisma.$executeRawUnsafe(
        `create table "${probeTable}" ("productId" text not null references "Product"("id") on delete restrict)`,
      );
      await prisma.$executeRawUnsafe(`insert into "${probeTable}" values ($1)`, id);

      const res = await request(app.getHttpServer())
        .delete(`/products/${id}`)
        .set('Cookie', admin)
        .expect(409);
      expect(res.body.message).toContain('Podés desactivarlo');
      expect(await prisma.product.findUnique({ where: { id } })).not.toBeNull();
    });
  });

  describe('proveedores', () => {
    it('crea, edita y desactiva un proveedor; normaliza el CUIT', async () => {
      const created = await request(app.getHttpServer())
        .post('/suppliers')
        .set('Cookie', user)
        .send({ name: name('Hacienda'), cuit: '30-71454243-1', phone: '11 4444-5555' })
        .expect(201);
      expect(created.body).toMatchObject({ cuit: '30714542431', active: true });
      const id = created.body.id as string;

      const edited = await request(app.getHttpServer())
        .patch(`/suppliers/${id}`)
        .set('Cookie', user)
        .send({ phone: '', active: false })
        .expect(200);
      expect(edited.body).toMatchObject({ phone: null, active: false });

      // El CUIT ya está en uso por este proveedor.
      await request(app.getHttpServer())
        .post('/suppliers')
        .set('Cookie', user)
        .send({ name: name('Otro'), cuit: '30714542431' })
        .expect(409);
    });

    it('rechaza un CUIT inválido', async () => {
      const res = await request(app.getHttpServer())
        .post('/suppliers')
        .set('Cookie', user)
        .send({ name: name('CUIT malo'), cuit: '30714542430' })
        .expect(400);
      expect(res.body.message).toContain('dígito verificador');
    });

    it('borrar es solo para ADMIN', async () => {
      const created = await request(app.getHttpServer())
        .post('/suppliers')
        .set('Cookie', user)
        .send({ name: name('Sin compras') })
        .expect(201);
      const id = created.body.id as string;
      await request(app.getHttpServer()).delete(`/suppliers/${id}`).set('Cookie', user).expect(403);
      await request(app.getHttpServer())
        .delete(`/suppliers/${id}`)
        .set('Cookie', admin)
        .expect(204);
    });
  });
});

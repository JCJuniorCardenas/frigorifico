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

// Requiere la base levantada y migrada: `pnpm db:up` y `pnpm --filter api db:migrate`.
describe('Auth y usuarios (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const suffix = randomUUID().slice(0, 8);
  const adminEmail = `e2e-admin-${suffix}@test.local`;
  const userEmail = `e2e-user-${suffix}@test.local`;
  const createdEmail = `e2e-created-${suffix}@test.local`;
  const password = 'clave-de-prueba-123';

  async function login(email: string, pass = password): Promise<string[]> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: pass })
      .expect(200);
    return res.get('Set-Cookie') ?? [];
  }

  beforeAll(async () => {
    // El rate limit del login se prueba aparte; acá se desactiva para poder loguear varias veces.
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
        { name: 'Admin E2E', email: adminEmail, role: 'ADMIN', passwordHash },
        { name: 'User E2E', email: userEmail, role: 'USER', passwordHash },
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { in: [adminEmail, userEmail, createdEmail] } },
    });
    await app.close();
  });

  it('sin sesión no se accede a rutas protegidas', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
    await request(app.getHttpServer()).get('/users').expect(401);
  });

  it('login con clave incorrecta devuelve 401 con mensaje genérico', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: userEmail, password: 'incorrecta' })
      .expect(401);
    expect(res.body.message).toBe('Email o contraseña incorrectos');
  });

  it('login exitoso setea cookies httpOnly y no expone la contraseña', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: userEmail.toUpperCase(), password })
      .expect(200);
    const cookies = res.get('Set-Cookie') ?? [];
    expect(cookies.some((c) => c.startsWith('access_token=') && c.includes('HttpOnly'))).toBe(true);
    expect(cookies.some((c) => c.startsWith('refresh_token=') && c.includes('HttpOnly'))).toBe(
      true,
    );
    expect(res.body.user).toMatchObject({ email: userEmail, role: 'USER' });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/);
  });

  it('un USER no puede acceder a rutas de ADMIN', async () => {
    const cookies = await login(userEmail);
    await request(app.getHttpServer()).get('/auth/me').set('Cookie', cookies).expect(200);
    await request(app.getHttpServer()).get('/users').set('Cookie', cookies).expect(403);
    await request(app.getHttpServer())
      .post('/users')
      .set('Cookie', cookies)
      .send({ name: 'Hack', email: 'hack@test.local', password: '12345678' })
      .expect(403);
  });

  it('un ADMIN crea un usuario y su contraseña queda hasheada', async () => {
    const cookies = await login(adminEmail);
    const res = await request(app.getHttpServer())
      .post('/users')
      .set('Cookie', cookies)
      .send({ name: 'Creado E2E', email: createdEmail, password: 'otra-clave-123' })
      .expect(201);
    expect(res.body).toMatchObject({ email: createdEmail, role: 'USER', active: true });
    expect(res.body).not.toHaveProperty('passwordHash');

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: createdEmail } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);

    await request(app.getHttpServer())
      .post('/users')
      .set('Cookie', cookies)
      .send({ name: 'Duplicado', email: createdEmail, password: 'otra-clave-123' })
      .expect(409);
  });

  it('valida el body y responde en español', async () => {
    const cookies = await login(adminEmail);
    const res = await request(app.getHttpServer())
      .post('/users')
      .set('Cookie', cookies)
      .send({ name: 'X', email: 'no-es-email', password: '123', extra: true })
      .expect(400);
    expect(JSON.stringify(res.body.message)).toContain('El email no es válido');
  });

  it('desactivar un usuario corta su sesión y le impide volver a entrar', async () => {
    const adminCookies = await login(adminEmail);
    const userCookies = await login(createdEmail, 'otra-clave-123');
    const created = await prisma.user.findUniqueOrThrow({ where: { email: createdEmail } });

    await request(app.getHttpServer())
      .patch(`/users/${created.id}`)
      .set('Cookie', adminCookies)
      .send({ active: false })
      .expect(200);

    await request(app.getHttpServer()).get('/auth/me').set('Cookie', userCookies).expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: createdEmail, password: 'otra-clave-123' })
      .expect(401);
  });

  it('logout invalida el refresh token', async () => {
    const cookies = await login(userEmail);
    await request(app.getHttpServer()).post('/auth/logout').set('Cookie', cookies).expect(204);
    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', cookies).expect(401);
  });

  it('refresh emite una sesión nueva', async () => {
    const cookies = await login(adminEmail);
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', cookies)
      .expect(200);
    expect(res.body.user.email).toBe(adminEmail);
  });
});

describe('Rate limit del login (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('bloquea con 429 después de 5 intentos por minuto', async () => {
    const attempt = () =>
      request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nadie@test.local', password: 'x' });
    for (let i = 0; i < 5; i++) {
      await attempt().expect(401);
    }
    await attempt().expect(429);
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';

// Requiere la base levantada: `pnpm db:up` desde la raíz.
describe('App (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok', db: 'ok' });
  });

  it('manda headers de seguridad y no revela la tecnología', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('los errores salen en español y con formato uniforme', async () => {
    const notFound = await request(app.getHttpServer()).get('/no-existe').expect(404);
    expect(notFound.body).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'No se encontró lo que buscabas.',
    });

    const noSession = await request(app.getHttpServer()).get('/invoices').expect(401);
    expect(noSession.body).toEqual({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Tenés que iniciar sesión',
    });

    const badJson = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ')
      .expect(400);
    expect(badJson.body).toMatchObject({ statusCode: 400, message: expect.any(String) });
    expect(JSON.stringify(badJson.body)).not.toMatch(/SyntaxError|at JSON/);
  });
});

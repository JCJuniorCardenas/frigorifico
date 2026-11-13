import { validateEnv } from './env.validation.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
};

describe('validateEnv', () => {
  it('acepta una configuración mínima de desarrollo', () => {
    expect(validateEnv({ ...base, JWT_ACCESS_SECRET: 'x', JWT_REFRESH_SECRET: 'y' })).toBeTruthy();
  });

  it('falla si falta la base o los secretos', () => {
    expect(() => validateEnv({})).toThrow(/Falta DATABASE_URL[\s\S]*Falta JWT_ACCESS_SECRET/);
  });

  it('no permite usar el mismo secreto para access y refresh', () => {
    expect(() => validateEnv({ ...base, JWT_REFRESH_SECRET: base.JWT_ACCESS_SECRET })).toThrow(
      /deben ser distintos/,
    );
  });

  it('en producción exige secretos largos y WEB_ORIGIN', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'cambiar-en-produccion',
      }),
    ).toThrow(/al menos 32 caracteres[\s\S]*Falta WEB_ORIGIN/);
    expect(
      validateEnv({ ...base, NODE_ENV: 'production', WEB_ORIGIN: 'https://faena.example.com' }),
    ).toBeTruthy();
  });

  it('valida duraciones y CUIT', () => {
    expect(() => validateEnv({ ...base, JWT_ACCESS_TTL: '15 minutos' })).toThrow(/JWT_ACCESS_TTL/);
    expect(() => validateEnv({ ...base, ISSUER_CUIT: '123' })).toThrow(/ISSUER_CUIT/);
  });
});

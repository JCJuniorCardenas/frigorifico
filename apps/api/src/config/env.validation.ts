import { parseDurationMs } from '../common/utils/duration.js';

/**
 * Valida las variables de entorno al arrancar: si falta algo crítico la API no levanta, en vez
 * de fallar más tarde con un error confuso. En producción exige secretos largos.
 */
export function validateEnv(env: Record<string, unknown>): Record<string, unknown> {
  const errors: string[] = [];
  const get = (key: string) => (typeof env[key] === 'string' ? (env[key] as string).trim() : '');
  const production = get('NODE_ENV') === 'production';

  for (const key of ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    if (!get(key)) errors.push(`Falta ${key}`);
  }
  if (get('DATABASE_URL') && !/^postgres(ql)?:\/\//.test(get('DATABASE_URL'))) {
    errors.push('DATABASE_URL debe ser una URL postgresql://');
  }
  if (get('JWT_ACCESS_SECRET') && get('JWT_ACCESS_SECRET') === get('JWT_REFRESH_SECRET')) {
    errors.push('JWT_ACCESS_SECRET y JWT_REFRESH_SECRET deben ser distintos');
  }
  if (production) {
    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
      const value = get(key);
      if (value && (value.length < 32 || /cambiar/i.test(value))) {
        errors.push(`${key} debe tener al menos 32 caracteres aleatorios en producción`);
      }
    }
    if (!get('WEB_ORIGIN')) errors.push('Falta WEB_ORIGIN (URL pública de la web)');
  }
  for (const key of ['JWT_ACCESS_TTL', 'JWT_REFRESH_TTL']) {
    if (get(key)) {
      try {
        parseDurationMs(get(key));
      } catch {
        errors.push(`${key} inválido (usar por ejemplo 15m o 7d)`);
      }
    }
  }
  if (get('ISSUER_CUIT') && !/^\d{11}$/.test(get('ISSUER_CUIT').replace(/-/g, ''))) {
    errors.push('ISSUER_CUIT debe tener 11 dígitos');
  }
  if (get('STORAGE_DRIVER') && get('STORAGE_DRIVER') !== 'local') {
    errors.push('STORAGE_DRIVER solo admite "local" por ahora');
  }

  if (errors.length > 0) {
    throw new Error(`Configuración inválida:\n - ${errors.join('\n - ')}`);
  }
  return env;
}

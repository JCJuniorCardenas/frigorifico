import { ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';

/**
 * Traduce errores de Prisma del catálogo a respuestas para el usuario.
 * - P2002 (único): nombre o CUIT repetido.
 * - P2003 (clave foránea): el registro tiene movimientos, compras o ventas asociadas. Las tablas
 *   del módulo de stock referencian productos y proveedores con ON DELETE RESTRICT, así que la
 *   propia base impide borrarlos: se sugiere desactivarlos.
 */
export function mapCatalogError(
  error: unknown,
  messages: { unique: string; inUse: string },
): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return new ConflictException(messages.unique);
    if (error.code === 'P2003') return new ConflictException(messages.inUse);
  }
  return error;
}

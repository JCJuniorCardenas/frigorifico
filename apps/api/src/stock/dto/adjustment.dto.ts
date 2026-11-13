import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { KG, trim } from '../../catalog/dto/catalog-validation.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Kilos con signo opcional y hasta 3 decimales: "-1.250", "+2", "3.5". */
const SIGNED_KG = /^[+-]?\d{1,9}(\.\d{1,3})?$/;

export const ADJUSTMENT_TYPES = ['WASTE', 'ADJUSTMENT'] as const;
export type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number];

/**
 * Merma o ajuste de stock. Se indica UNA de estas cantidades:
 * - `kg`: en una merma, los kg perdidos (positivo); en un ajuste, la diferencia con signo.
 * - `countedKg` (solo ajustes): los kg contados físicamente; la diferencia la calcula la API.
 */
export class CreateAdjustmentDto {
  @IsUUID('all', { message: 'Elegí un producto' })
  productId: string;

  @IsIn(ADJUSTMENT_TYPES, { message: 'El tipo debe ser WASTE (merma) o ADJUSTMENT (ajuste)' })
  type: AdjustmentType;

  @IsOptional()
  @Transform(trim)
  @Matches(SIGNED_KG, { message: 'Los kg deben ser un número con hasta 3 decimales (ej. 1.5)' })
  kg?: string;

  @IsOptional()
  @Transform(trim)
  @Matches(KG, { message: 'Los kg contados deben ser un número con hasta 3 decimales' })
  countedKg?: string;

  @Transform(trim)
  @IsString({ message: 'El motivo es obligatorio' })
  @MinLength(3, { message: 'El motivo debe tener al menos 3 caracteres' })
  @MaxLength(200, { message: 'El motivo no puede superar los 200 caracteres' })
  reason: string;

  /** Por defecto, hoy. */
  @IsOptional()
  @Matches(DATE, { message: 'La fecha debe tener formato aaaa-mm-dd' })
  date?: string;

  /** Igual que en ventas: confirma un movimiento que deja el stock negativo. */
  @IsOptional()
  @IsBoolean({ message: 'confirmNegativeStock debe ser verdadero o falso' })
  confirmNegativeStock?: boolean;
}

export class ListAdjustmentsQueryDto {
  @IsOptional()
  @Matches(DATE, { message: 'La fecha "desde" debe tener formato aaaa-mm-dd' })
  from?: string;

  @IsOptional()
  @Matches(DATE, { message: 'La fecha "hasta" debe tener formato aaaa-mm-dd' })
  to?: string;

  @IsOptional()
  @IsUUID('all', { message: 'Producto inválido' })
  productId?: string;

  @IsOptional()
  @IsIn(ADJUSTMENT_TYPES, { message: 'El tipo debe ser WASTE o ADJUSTMENT' })
  type?: AdjustmentType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;
}

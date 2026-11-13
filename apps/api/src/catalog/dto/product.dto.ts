import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ProductUnit } from '../../generated/prisma/enums.js';
import { KG, MONEY, trim, trimToNull } from './catalog-validation.js';

const NAME_MESSAGE = { message: 'El nombre debe tener entre 2 y 100 caracteres' };
const PRICE_MESSAGE = {
  message: 'El precio sugerido debe ser un número no negativo con hasta 2 decimales (ej. 4500.50)',
};
const MIN_STOCK_MESSAGE = {
  message: 'El stock mínimo debe ser un número no negativo con hasta 3 decimales (ej. 10.5)',
};

export class CreateProductDto {
  @Transform(trim)
  @IsString({ message: 'El nombre es obligatorio' })
  @MinLength(2, NAME_MESSAGE)
  @MaxLength(100, NAME_MESSAGE)
  name: string;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(50, { message: 'La categoría no puede superar los 50 caracteres' })
  category?: string | null;

  @IsOptional()
  @IsEnum(ProductUnit, { message: 'La unidad debe ser KG o UNIT' })
  unit?: ProductUnit;

  @IsOptional()
  @Transform(trimToNull)
  @Matches(MONEY, PRICE_MESSAGE)
  salePrice?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @Matches(KG, MIN_STOCK_MESSAGE)
  minStockKg?: string | null;
}

/** Edición: todos los campos opcionales; `active: false` desactiva el producto. */
export class UpdateProductDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2, NAME_MESSAGE)
  @MaxLength(100, NAME_MESSAGE)
  name?: string;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(50, { message: 'La categoría no puede superar los 50 caracteres' })
  category?: string | null;

  @IsOptional()
  @IsEnum(ProductUnit, { message: 'La unidad debe ser KG o UNIT' })
  unit?: ProductUnit;

  @IsOptional()
  @Transform(trimToNull)
  @Matches(MONEY, PRICE_MESSAGE)
  salePrice?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @Matches(KG, MIN_STOCK_MESSAGE)
  minStockKg?: string | null;

  @IsOptional()
  @IsBoolean({ message: 'El campo activo debe ser verdadero o falso' })
  active?: boolean;
}

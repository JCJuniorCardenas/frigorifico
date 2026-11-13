import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { KG, MONEY, trim, trimToNull } from '../../catalog/dto/catalog-validation.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HERD = /^\d{1,10}$/;

export class PurchaseItemDto {
  @IsUUID('all', { message: 'Elegí un producto' })
  productId: string;

  @Transform(trim)
  @Matches(KG, { message: 'Los kg deben ser un número con hasta 3 decimales (ej. 120.5)' })
  kg: string;

  @Transform(trim)
  @Matches(MONEY, {
    message: 'El costo por kg debe ser un número con hasta 2 decimales (ej. 4500.50)',
  })
  costPerKg: string;
}

export class CreatePurchaseDto {
  @Matches(DATE, { message: 'La fecha debe tener formato aaaa-mm-dd' })
  date: string;

  @IsUUID('all', { message: 'Elegí un proveedor' })
  supplierId: string;

  @IsOptional()
  @Transform(trimToNull)
  @Matches(HERD, { message: 'El número de tropa debe ser numérico' })
  herdNumber?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(500, { message: 'Las notas no pueden superar los 500 caracteres' })
  notes?: string | null;

  @IsArray({ message: 'Cargá al menos un ítem' })
  @ArrayMinSize(1, { message: 'Cargá al menos un ítem' })
  @ArrayMaxSize(100, { message: 'Un ingreso no puede tener más de 100 ítems' })
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemDto)
  items: PurchaseItemDto[];
}

export class ListPurchasesQueryDto {
  @IsOptional()
  @Matches(DATE, { message: 'La fecha "desde" debe tener formato aaaa-mm-dd' })
  from?: string;

  @IsOptional()
  @Matches(DATE, { message: 'La fecha "hasta" debe tener formato aaaa-mm-dd' })
  to?: string;

  @IsOptional()
  @IsUUID('all', { message: 'Proveedor inválido' })
  supplierId?: string;

  /** Número de tropa (búsqueda exacta). */
  @IsOptional()
  @Transform(trimToNull)
  @Matches(HERD, { message: 'El número de tropa debe ser numérico' })
  herdNumber?: string;

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

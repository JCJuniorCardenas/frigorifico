import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
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
  ValidateNested,
} from 'class-validator';
import { KG, MONEY, trim, trimToNull } from '../../catalog/dto/catalog-validation.js';
import { PaymentMethod } from '../../generated/prisma/enums.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAYMENT_MESSAGE = { message: 'La forma de pago debe ser CASH, TRANSFER, CARD u OTHER' };

export class SaleItemDto {
  @IsUUID('all', { message: 'Elegí un producto' })
  productId: string;

  @Transform(trim)
  @Matches(KG, { message: 'Los kg deben ser un número con hasta 3 decimales (ej. 1.250)' })
  kg: string;

  @Transform(trim)
  @Matches(MONEY, {
    message: 'El precio por kg debe ser un número con hasta 2 decimales (ej. 8500.50)',
  })
  pricePerKg: string;
}

export class CreateSaleDto {
  /** Por defecto, hoy. */
  @IsOptional()
  @Matches(DATE, { message: 'La fecha debe tener formato aaaa-mm-dd' })
  date?: string;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(150, { message: 'El cliente no puede superar los 150 caracteres' })
  customerName?: string | null;

  @IsOptional()
  @IsEnum(PaymentMethod, PAYMENT_MESSAGE)
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(500, { message: 'Las notas no pueden superar los 500 caracteres' })
  notes?: string | null;

  @IsArray({ message: 'Cargá al menos un ítem' })
  @ArrayMinSize(1, { message: 'Cargá al menos un ítem' })
  @ArrayMaxSize(100, { message: 'Una venta no puede tener más de 100 ítems' })
  @ValidateNested({ each: true })
  @Type(() => SaleItemDto)
  items: SaleItemDto[];

  /**
   * La venta dejaría algún producto con stock negativo: sin esto la API responde 409 con el
   * detalle, y el usuario confirma (en la carnicería a veces se vende antes de cargar el ingreso).
   */
  @IsOptional()
  @IsBoolean({ message: 'confirmNegativeStock debe ser verdadero o falso' })
  confirmNegativeStock?: boolean;
}

export class VoidSaleDto {
  @Transform(trim)
  @IsString({ message: 'Indicá el motivo de la anulación' })
  @MinLength(3, { message: 'El motivo debe tener al menos 3 caracteres' })
  @MaxLength(200, { message: 'El motivo no puede superar los 200 caracteres' })
  reason: string;
}

export const SALE_STATUS_FILTERS = ['active', 'voided', 'all'] as const;

export class ListSalesQueryDto {
  @IsOptional()
  @Matches(DATE, { message: 'La fecha "desde" debe tener formato aaaa-mm-dd' })
  from?: string;

  @IsOptional()
  @Matches(DATE, { message: 'La fecha "hasta" debe tener formato aaaa-mm-dd' })
  to?: string;

  @IsOptional()
  @IsEnum(PaymentMethod, PAYMENT_MESSAGE)
  paymentMethod?: PaymentMethod;

  /** active = no anuladas (por defecto), voided = solo anuladas, all = todas. */
  @IsOptional()
  @IsIn(SALE_STATUS_FILTERS, { message: 'Estado inválido (active, voided o all)' })
  status: (typeof SALE_STATUS_FILTERS)[number] = 'active';

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

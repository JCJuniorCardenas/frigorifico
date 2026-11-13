import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsUUID,
  Matches,
} from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ChangeStatusDto {
  @IsIn(['PENDING', 'PAID'], { message: 'El estado debe ser PENDING o PAID' })
  status: 'PENDING' | 'PAID';

  /** Fecha de cobro (solo para PAID). Si no se indica, hoy. */
  @IsOptional()
  @Matches(DATE, { message: 'La fecha de pago debe tener formato aaaa-mm-dd' })
  paidAt?: string;
}

export class BulkChangeStatusDto extends ChangeStatusDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Elegí al menos una factura' })
  @ArrayMaxSize(500, { message: 'Se pueden cambiar hasta 500 facturas a la vez' })
  @ArrayUnique({ message: 'Hay facturas repetidas en la selección' })
  @IsUUID('all', { each: true, message: 'Identificador de factura inválido' })
  ids: string[];
}

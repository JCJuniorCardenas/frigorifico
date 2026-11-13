import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateInvoiceDto } from './create-invoice.dto.js';

/** Edición de los datos de una factura ya guardada (todos los campos opcionales). */
export class UpdateInvoiceDto extends PartialType(CreateInvoiceDto) {
  /** Permite marcarla como revisada (false) o volver a marcarla para revisar (true). */
  @IsOptional()
  @IsBoolean({ message: 'needsReview debe ser verdadero o falso' })
  needsReview?: boolean;
}

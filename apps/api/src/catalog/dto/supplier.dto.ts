import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { cuitOrNull, trim, trimToNull } from './catalog-validation.js';

const NAME_MESSAGE = { message: 'El nombre debe tener entre 2 y 150 caracteres' };
const CUIT_MESSAGE = { message: 'El CUIT debe tener 11 dígitos' };
const PHONE = /^[\d\s()+-]{6,30}$/;
const PHONE_MESSAGE = { message: 'El teléfono solo puede tener números, espacios y + ( ) -' };

export class CreateSupplierDto {
  @Transform(trim)
  @IsString({ message: 'El nombre es obligatorio' })
  @MinLength(2, NAME_MESSAGE)
  @MaxLength(150, NAME_MESSAGE)
  name: string;

  @IsOptional()
  @Transform(cuitOrNull)
  @Matches(/^\d{11}$/, CUIT_MESSAGE)
  cuit?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @Matches(PHONE, PHONE_MESSAGE)
  phone?: string | null;
}

/** Edición: todos los campos opcionales; `active: false` desactiva el proveedor. */
export class UpdateSupplierDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2, NAME_MESSAGE)
  @MaxLength(150, NAME_MESSAGE)
  name?: string;

  @IsOptional()
  @Transform(cuitOrNull)
  @Matches(/^\d{11}$/, CUIT_MESSAGE)
  cuit?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @Matches(PHONE, PHONE_MESSAGE)
  phone?: string | null;

  @IsOptional()
  @IsBoolean({ message: 'El campo activo debe ser verdadero o falso' })
  active?: boolean;
}

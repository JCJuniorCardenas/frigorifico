import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

/** `?active=true` lista solo los activos (para los selectores de compras y ventas). */
export class ListCatalogDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean({ message: 'El filtro activo debe ser true o false' })
  active?: boolean;
}

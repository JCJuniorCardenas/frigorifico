import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Filtro común de los reportes. Sin fechas: el mes actual. */
export class ReportQueryDto {
  @IsOptional()
  @Matches(DATE, { message: 'La fecha "desde" debe tener formato aaaa-mm-dd' })
  from?: string;

  @IsOptional()
  @Matches(DATE, { message: 'La fecha "hasta" debe tener formato aaaa-mm-dd' })
  to?: string;

  /** csv descarga una tabla del reporte (ver `section`). */
  @IsOptional()
  @IsIn(['json', 'csv'], { message: 'El formato debe ser json o csv' })
  format: 'json' | 'csv' = 'json';

  /** Qué tabla exportar a CSV (cada reporte tiene las suyas; por defecto, la principal). */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  section?: string;
}

import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export const STATUS_FILTERS = ['pending', 'overdue', 'paid', 'all'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const SORT_FIELDS = [
  'clientName',
  'herdNumber',
  'slaughterKg',
  'totalAmount',
  'paymentDueDate',
  'issueDate',
  'voucherNumber',
  'status',
  'paidAt',
] as const;
export type SortField = (typeof SORT_FIELDS)[number];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ListInvoicesQueryDto {
  /** Busca por cliente, tropa o número de comprobante. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(STATUS_FILTERS, { message: 'Estado inválido (pending, overdue, paid o all)' })
  status: StatusFilter = 'pending';

  @IsOptional()
  @Matches(/^\d{11}$/, { message: 'El CUIT del cliente debe tener 11 dígitos' })
  clientCuit?: string;

  /** A qué fecha aplica el rango: emisión o vencimiento. */
  @IsOptional()
  @IsIn(['issue', 'due'], { message: 'dateField debe ser issue o due' })
  dateField: 'issue' | 'due' = 'issue';

  @IsOptional()
  @Matches(DATE, { message: 'La fecha "desde" debe tener formato aaaa-mm-dd' })
  from?: string;

  @IsOptional()
  @Matches(DATE, { message: 'La fecha "hasta" debe tener formato aaaa-mm-dd' })
  to?: string;

  @IsOptional()
  @IsIn(SORT_FIELDS, { message: 'Campo de orden inválido' })
  sort?: SortField;

  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'El orden debe ser asc o desc' })
  dir?: 'asc' | 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100, { message: 'Se pueden pedir hasta 100 facturas por página' })
  pageSize = 25;
}

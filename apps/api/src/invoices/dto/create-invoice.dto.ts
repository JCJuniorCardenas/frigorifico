import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const onlyDigits = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/[\s-]/g, '') : value;

/** Fecha calendario "aaaa-mm-dd" (sin hora ni zona). */
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Decimal con punto y hasta 2 decimales, no negativo: "439211.86". Nunca number. */
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const KG = /^\d{1,10}(\.\d{1,2})?$/;

const dateMessage = (label: string) => ({ message: `${label} debe tener formato aaaa-mm-dd` });
const amountMessage = (label: string) => ({
  message: `${label} debe ser un número no negativo con hasta 2 decimales (ej. 1234.56)`,
});

/** Datos de la factura confirmados por el usuario en la pantalla de revisión. */
export class CreateInvoiceDto {
  @Transform(onlyDigits)
  @Matches(/^\d{5}$/, { message: 'El punto de venta debe tener 5 dígitos' })
  salesPoint: string;

  @Transform(onlyDigits)
  @Matches(/^\d{8}$/, { message: 'El número de comprobante debe tener 8 dígitos' })
  voucherNumber: string;

  @Matches(DATE, dateMessage('La fecha de emisión'))
  issueDate: string;

  @Matches(DATE, dateMessage('La fecha de vencimiento'))
  paymentDueDate: string;

  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'La razón social del cliente es obligatoria' })
  @MaxLength(200)
  clientName: string;

  @Transform(onlyDigits)
  @Matches(/^\d{11}$/, { message: 'El CUIT del cliente debe tener 11 dígitos' })
  clientCuit: string;

  @Transform(trim)
  @Matches(/^\d{1,10}$/, { message: 'El número de tropa debe ser numérico' })
  herdNumber: string;

  @Matches(KG, amountMessage('Los kg de faena'))
  slaughterKg: string;

  @Matches(MONEY, amountMessage('El importe total'))
  totalAmount: string;

  @Matches(MONEY, amountMessage('El importe neto gravado'))
  netTaxedAmount: string;

  @Matches(MONEY, amountMessage('El IVA 21%'))
  vat21Amount: string;

  @Matches(MONEY, amountMessage('El importe exento'))
  exemptAmount: string;

  @Transform(onlyDigits)
  @Matches(/^\d{14}$/, { message: 'El CAE debe tener 14 dígitos' })
  cae: string;

  @Matches(DATE, dateMessage('La fecha de vencimiento del CAE'))
  caeDueDate: string;
}

import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  type AdjustmentListResponse,
  type AdjustmentResult,
  AdjustmentsService,
} from './adjustments.service.js';
import { CreateAdjustmentDto, ListAdjustmentsQueryDto } from './dto/adjustment.dto.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import {
  CreatePurchaseDto,
  InvoiceCandidatesQueryDto,
  LinkInvoiceDto,
  ListPurchasesQueryDto,
} from './dto/purchase.dto.js';
import {
  type LinkedInvoice,
  type PurchaseDetail,
  type PurchaseListResponse,
  PurchasesService,
} from './purchases.service.js';
import { type MovementRow, type StockResponse, StockService } from './stock.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@Controller('stock')
export class StockController {
  constructor(
    private readonly stock: StockService,
    private readonly adjustments: AdjustmentsService,
  ) {}

  @Get()
  current(): Promise<StockResponse> {
    return this.stock.getStock();
  }

  /** Historial de mermas y ajustes. */
  @Get('adjustments')
  listAdjustments(@Query() query: ListAdjustmentsQueryDto): Promise<AdjustmentListResponse> {
    return this.adjustments.list(query);
  }

  /** Registrar una merma o un ajuste (siempre con motivo). */
  @Post('adjustments')
  createAdjustment(
    @Body() dto: CreateAdjustmentDto,
    @CurrentUser() user: AuthUser,
  ): Promise<AdjustmentResult> {
    return this.adjustments.create(dto, user.id);
  }

  @Get(':productId/movements')
  movements(@Param('productId', uuid) productId: string): Promise<MovementRow[]> {
    return this.stock.movements(productId);
  }
}

@Controller('purchases')
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get()
  list(@Query() query: ListPurchasesQueryDto): Promise<PurchaseListResponse> {
    return this.purchases.list(query);
  }

  @Post()
  create(@Body() dto: CreatePurchaseDto, @CurrentUser() user: AuthUser): Promise<PurchaseDetail> {
    return this.purchases.create(dto, user.id);
  }

  /** Facturas de faena con esa tropa (para sugerir el vínculo). Va antes de ':id'. */
  @Get('invoice-candidates')
  invoiceCandidates(@Query() query: InvoiceCandidatesQueryDto): Promise<LinkedInvoice[]> {
    return this.purchases.invoiceCandidates(query.herdNumber);
  }

  @Get(':id')
  findOne(@Param('id', uuid) id: string): Promise<PurchaseDetail> {
    return this.purchases.findOne(id);
  }

  /** Vincular o desvincular la factura de faena de un ingreso ya cargado. */
  @Patch(':id/invoice')
  setInvoice(@Param('id', uuid) id: string, @Body() dto: LinkInvoiceDto): Promise<PurchaseDetail> {
    return this.purchases.setInvoice(id, dto.invoiceId);
  }
}

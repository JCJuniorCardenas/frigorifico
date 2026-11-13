import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { CreatePurchaseDto, ListPurchasesQueryDto } from './dto/purchase.dto.js';
import {
  type PurchaseDetail,
  type PurchaseListResponse,
  PurchasesService,
} from './purchases.service.js';
import { type MovementRow, type StockResponse, StockService } from './stock.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get()
  current(): Promise<StockResponse> {
    return this.stock.getStock();
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

  @Get(':id')
  findOne(@Param('id', uuid) id: string): Promise<PurchaseDetail> {
    return this.purchases.findOne(id);
  }
}

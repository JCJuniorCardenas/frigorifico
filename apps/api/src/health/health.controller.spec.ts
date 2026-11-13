import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import type { PrismaService } from '../prisma/prisma.service.js';

describe('HealthController', () => {
  it('responde ok cuando la base contesta', async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const controller = new HealthController(prisma as unknown as PrismaService);
    await expect(controller.check()).resolves.toEqual({ status: 'ok', db: 'ok' });
  });

  it('devuelve 503 cuando la base no responde', async () => {
    const prisma = { $queryRaw: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
    const controller = new HealthController(prisma as unknown as PrismaService);
    await expect(controller.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

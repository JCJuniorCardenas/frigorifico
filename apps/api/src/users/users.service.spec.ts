import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../common/auth-user.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { UsersService } from './users.service.js';

const admin: AuthUser = { id: 'admin-id', name: 'Admin', email: 'a@x.com', role: 'ADMIN' };
const storedUser = {
  id: 'user-id',
  name: 'Usuario',
  email: 'u@x.com',
  role: 'USER' as const,
  active: true,
  tokenVersion: 0,
  passwordHash: 'hash',
};

function setup(found: object | null = storedUser) {
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue(found),
      update: vi.fn().mockImplementation(({ data }: { data: object }) => Promise.resolve(data)),
      create: vi.fn().mockImplementation(({ data }: { data: object }) => Promise.resolve(data)),
    },
  };
  return { prisma, service: new UsersService(prisma as unknown as PrismaService) };
}

describe('UsersService', () => {
  it('guarda la contraseña hasheada con argon2, nunca en texto plano', async () => {
    const { prisma, service } = setup();
    await service.create({ name: 'Nuevo', email: 'n@x.com', password: 'clave-segura-123' });
    const data = prisma.user.create.mock.calls[0][0].data as { passwordHash: string };
    expect(data.passwordHash).toMatch(/^\$argon2id\$/);
    expect(data.passwordHash).not.toContain('clave-segura-123');
    expect(data).not.toHaveProperty('password');
  });

  it('crea usuarios con rol USER por defecto', async () => {
    const { prisma, service } = setup();
    await service.create({ name: 'Nuevo', email: 'n@x.com', password: 'clave-segura-123' });
    expect(prisma.user.create.mock.calls[0][0].data).toMatchObject({ role: 'USER' });
  });

  it('no permite que un ADMIN se desactive a sí mismo', async () => {
    const { service } = setup({ ...storedUser, id: admin.id, role: 'ADMIN' });
    await expect(service.update(admin.id, { active: false }, admin)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('no permite que un ADMIN se quite el rol de administrador', async () => {
    const { service } = setup({ ...storedUser, id: admin.id, role: 'ADMIN' });
    await expect(service.update(admin.id, { role: 'USER' }, admin)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('devuelve 404 si el usuario no existe', async () => {
    const { service } = setup(null);
    await expect(service.update('nope', { name: 'X' }, admin)).rejects.toThrow(NotFoundException);
  });

  it.each([
    ['resetear la clave', { password: 'otra-clave-123' }],
    ['desactivar', { active: false }],
    ['cambiar el rol', { role: 'ADMIN' as const }],
  ])('al %s se cierran las sesiones del usuario', async (_label, dto) => {
    const { prisma, service } = setup();
    await service.update(storedUser.id, dto, admin);
    expect(prisma.user.update.mock.calls[0][0].data).toMatchObject({
      tokenVersion: { increment: 1 },
    });
  });

  it('cambiar solo el nombre no cierra las sesiones', async () => {
    const { prisma, service } = setup();
    await service.update(storedUser.id, { name: 'Otro nombre' }, admin);
    expect(prisma.user.update.mock.calls[0][0].data).not.toHaveProperty('tokenVersion');
  });
});

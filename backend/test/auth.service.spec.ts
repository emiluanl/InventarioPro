// =============================================================================
// Tests de AuthService (login, register, refresh)
// =============================================================================
// Usamos mocks para Prisma, JwtService, ConfigService y EmailService.
// No necesitamos una BD real: solo verificamos la lógica de negocio.
// =============================================================================

import { Test, type TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

import { AuthService } from '../src/auth/auth.service';
import { EmailService } from '../src/auth/email.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: any;
  let jwt: any;
  let email: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      refreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn((ops) => Promise.all(ops)),
    };
    jwt = {
      signAsync: jest.fn().mockResolvedValue('fake.access.token'),
    };
    email = {
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) => {
              const map: Record<string, string> = {
                JWT_ACCESS_SECRET: 'a'.repeat(32),
                JWT_ACCESS_TTL: '15m',
                JWT_REFRESH_TTL: '7d',
              };
              return map[k];
            },
          },
        },
        { provide: EmailService, useValue: email },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // ===========================================================================
  // REGISTER
  // ===========================================================================
  describe('register', () => {
    it('crea el usuario si el email no existe', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'u1', email: 'a@b.com' });

      const result = await service.register({
        email: 'a@b.com',
        password: 'Password123',
        nombre: 'A',
      });

      expect(result.message).toContain('Registro completado');
      expect(prisma.user.create).toHaveBeenCalledTimes(1);
      expect(email.sendVerificationEmail).toHaveBeenCalled();
    });

    it('lanza ConflictException si el email ya existe', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      await expect(
        service.register({ email: 'a@b.com', password: 'Password123', nombre: 'A' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ===========================================================================
  // LOGIN
  // ===========================================================================
  describe('login', () => {
    it('emite tokens si las credenciales son válidas y el email está verificado', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        password_hash: 'fake-hash',
        email_verificado: true,
      });
      // Espiamos verifyPassword (no podemos mockear argon2 dinámicamente fácil,
      // pero password_hash fake hará que argon2.verify devuelva false y lance
      // UnauthorizedException). En su lugar, parcheamos el método del service:
      (service as any).verifyPassword = jest.fn().mockResolvedValue(true);

      const result = await service.login({ email: 'a@b.com', password: 'Password123' });

      expect(result.access_token).toBe('fake.access.token');
      expect(result.refresh_token).toBeDefined();
      expect(result.user).toEqual({ id: 'u1', email: 'a@b.com' });
      expect(prisma.refreshToken.create).toHaveBeenCalled();
    });

    it('rechaza el login si el email aún no está verificado', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        password_hash: 'fake-hash',
        email_verificado: false,
      });
      (service as any).verifyPassword = jest.fn().mockResolvedValue(true);

      await expect(service.login({ email: 'a@b.com', password: 'Password123' })).rejects.toThrow(
        'Debes verificar tu email',
      );
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('lanza UnauthorizedException con mensaje genérico si el usuario no existe', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.login({ email: 'a@b.com', password: 'x' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('lanza UnauthorizedException si la contraseña es incorrecta', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        password_hash: 'fake-hash',
      });
      (service as any).verifyPassword = jest.fn().mockResolvedValue(false);

      await expect(service.login({ email: 'a@b.com', password: 'wrong' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  // ===========================================================================
  // REFRESH
  // ===========================================================================
  describe('refresh', () => {
    it('rota el token y emite uno nuevo', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt1',
        revoked_at: null,
        expires_at: new Date(Date.now() + 100000),
        user: { id: 'u1', email: 'a@b.com' },
      });
      prisma.refreshToken.update.mockResolvedValue({});

      const result = await service.refresh('some-token');

      expect(result.access_token).toBeDefined();
      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt1' },
        data: { revoked_at: expect.any(Date) },
      });
    });

    it('rechaza un token revocado', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt1',
        revoked_at: new Date(),
        expires_at: new Date(Date.now() + 100000),
        user: { id: 'u1' },
      });

      await expect(service.refresh('some-token')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rechaza un token expirado', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt1',
        revoked_at: null,
        expires_at: new Date(Date.now() - 1000),
        user: { id: 'u1' },
      });

      await expect(service.refresh('some-token')).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  // ===========================================================================
  // LOGOUT
  // ===========================================================================
  describe('logout', () => {
    it('invalida todos los tokens del usuario si no se pasa refresh_token', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });
      await service.logout('u1');
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { user_id: 'u1', revoked_at: null },
        data: { revoked_at: expect.any(Date) },
      });
    });
  });

  // ===========================================================================
  // FORGOT PASSWORD
  // ===========================================================================
  describe('forgotPassword', () => {
    it('SIEMPRE devuelve el mismo mensaje (privacidad)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const result = await service.forgotPassword('ghost@x.com');
      expect(result.message).toContain('Si la cuenta existe');
      expect(email.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('envía email si el usuario existe', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'real@x.com' });
      prisma.user.update.mockResolvedValue({});
      await service.forgotPassword('real@x.com');
      expect(email.sendPasswordResetEmail).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // RESET PASSWORD
  // ===========================================================================
  describe('resetPassword', () => {
    it('rechaza un token inválido', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(
        service.resetPassword({ token: 'x'.repeat(40), new_password: 'NewPass123' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('cambia la contraseña y revoca todos los tokens', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1' });
      (service as any).hashPassword = jest.fn().mockResolvedValue('new-hash');
      prisma.user.update.mockResolvedValue({});
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.resetPassword({
        token: 'x'.repeat(40),
        new_password: 'NewPass123',
      });

      expect(result.message).toContain('actualizada');
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // RESEND VERIFICATION EMAIL
  // ===========================================================================
  describe('resendVerificationEmail', () => {
    it('genera un token nuevo y envía el email si la cuenta no está verificada', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        email_verificado: false,
      });
      prisma.user.update.mockResolvedValue({});

      const result = await service.resendVerificationEmail('a@b.com');

      expect(result.message).toContain('nuevo enlace');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1' },
          data: expect.objectContaining({ email_verification_token: expect.any(String) }),
        }),
      );
      expect(email.sendVerificationEmail).toHaveBeenCalled();
    });

    it('NO reenvía si la cuenta ya está verificada (mismo mensaje genérico)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        email_verificado: true,
      });

      const result = await service.resendVerificationEmail('a@b.com');

      expect(result.message).toContain('nuevo enlace');
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(email.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('devuelve el mismo mensaje si el email no existe (no enumera cuentas)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.resendVerificationEmail('ghost@x.com');

      expect(result.message).toContain('nuevo enlace');
      expect(email.sendVerificationEmail).not.toHaveBeenCalled();
    });
  });
});

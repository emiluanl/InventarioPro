// =============================================================================
// Mock de PrismaService para tests de integración
// =============================================================================
// Sustituye la BD real por mocks de jest. Cada test configura los valores que
// necesita con mockResolvedValue / mockImplementation; el estado se limpia
// con jest.clearAllMocks() en cada test.
// =============================================================================

export interface MockPrisma {
  $connect: jest.Mock;
  $disconnect: jest.Mock;
  user: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  category: { upsert: jest.Mock; findMany: jest.Mock };
  refreshToken: {
    create: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  chatConversation: {
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    findMany: jest.Mock;
  };
  chatMessage: { findMany: jest.Mock; create: jest.Mock };
  product: { findMany: jest.Mock };
  notification: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
}

export function buildPrismaMock(): MockPrisma {
  return {
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    category: { upsert: jest.fn(), findMany: jest.fn() },
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    chatConversation: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    chatMessage: { findMany: jest.fn(), create: jest.fn() },
    product: { findMany: jest.fn() },
    notification: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
}

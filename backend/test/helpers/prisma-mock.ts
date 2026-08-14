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
  $transaction: jest.Mock;
  $queryRaw: jest.Mock;
  user: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    delete: jest.Mock;
  };
  productAttachment: { findMany: jest.Mock };
  category: { upsert: jest.Mock; findMany: jest.Mock; findFirst: jest.Mock; create: jest.Mock };
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
  product: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  notification: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  pushSubscription: {
    upsert: jest.Mock;
    findMany: jest.Mock;
    deleteMany: jest.Mock;
  };
}

export function buildPrismaMock(): MockPrisma {
  return {
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    $queryRaw: jest.fn().mockResolvedValue([{ ok: 1 }]),
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    productAttachment: { findMany: jest.fn() },
    category: { upsert: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
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
    product: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    notification: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    pushSubscription: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
}

import { Test, TestingModule } from '@nestjs/testing';
import { MppxService } from './mppx.service';
import { VerifierService } from './verifier.service';

jest.mock(
  'mppx/server',
  () => ({
    Mppx: {
      create: jest.fn().mockReturnValue({ compose: jest.fn() }),
    },
  }),
  { virtual: true },
);

jest.mock(
  'mppx-multiversx/server',
  () => ({
    charge: jest
      .fn()
      .mockImplementation((options) => ({ _method: 'charge', options })),
    session: jest
      .fn()
      .mockImplementation((options) => ({ _method: 'session', options })),
    subscription: jest
      .fn()
      .mockImplementation((options) => ({ _method: 'subscription', options })),
  }),
  { virtual: true },
);

import { charge } from 'mppx-multiversx/server';

describe('MppxService', () => {
  let service: MppxService;
  let verifierService: VerifierService;

  beforeEach(async () => {
    process.env.MPP_SECRET_KEY = 'test-secret';
    process.env.MPP_DEFAULT_CURRENCY = 'EGLD';
    process.env.MPP_CHAIN_ID = 'D';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MppxService,
        {
          provide: VerifierService,
          useValue: {
            verifyTransaction: jest.fn().mockResolvedValue(true),
          },
        },
      ],
    }).compile();

    service = module.get<MppxService>(MppxService);
    verifierService = module.get<VerifierService>(VerifierService);
  });

  afterEach(() => {
    delete process.env.MPP_SECRET_KEY;
    delete process.env.MPP_DEFAULT_CURRENCY;
    delete process.env.MPP_CHAIN_ID;
    delete process.env.MPP_TOKEN_DECIMALS;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should initialize Mppx instance and methods', () => {
    expect(service.instance).toBeDefined();
    expect(service.mvxChargeMethod).toBeDefined();
    expect(service.mvxSessionMethod).toBeDefined();
    expect(service.mvxSubscriptionMethod).toBeDefined();
  });

  it('should throw error if MPP_SECRET_KEY is not defined', () => {
    delete process.env.MPP_SECRET_KEY;
    expect(() => new MppxService(verifierService)).toThrow(
      'MPP_SECRET_KEY environment variable is required',
    );
  });

  it('should call verifyTransaction correctly through the callback', async () => {
    const chargeOptions = (charge as jest.Mock).mock.calls[0][0];
    const verifyCb = chargeOptions.verifyTransaction;

    await verifyCb({
      txHash: 'hash1',
      sender: 'sender1',
      challengeId: 'chall1',
      amount: '100',
    });

    expect(verifierService.verifyTransaction).toHaveBeenCalledWith(
      'hash1',
      'sender1',
      'chall1',
      '100',
      'EGLD',
      undefined,
      undefined,
      undefined,
    );

    await verifyCb({
      txHash: 'hash2',
      sender: 'sender2',
      challengeId: 'chall2',
      amount: '200',
      currency: 'USDC',
      source: 'src',
      opaque: { key: 'val' },
      digest: 'dig',
    });

    expect(verifierService.verifyTransaction).toHaveBeenCalledWith(
      'hash2',
      'sender2',
      'chall2',
      '200',
      'USDC',
      'src',
      { key: 'val' },
      'dig',
    );
  });
});

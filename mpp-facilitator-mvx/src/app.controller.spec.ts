import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { MppxService } from './mppx.service';
import { RelayerService } from './relayer.service';
import { StorageService } from './storage.service';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';

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

describe('AppController', () => {
  let appController: AppController;
  let mppxService: MppxService;
  let relayerService: RelayerService;
  let storageService: StorageService;

  beforeEach(async () => {
    // Mock the global Request/Response if not present (usually in node environment for fetch)
    if (typeof global.Request === 'undefined') {
      (global as any).Request = class Request {
        constructor(
          public url: string,
          public options: any,
        ) {}
      };
    }
    if (typeof global.Response === 'undefined') {
      (global as any).Response = class Response {
        constructor(
          public body: any,
          public init: any,
        ) {
          this.headers = new Map();
        }
        headers: Map<string, string>;
        async text() {
          if (
            this.body &&
            this.body.includes &&
            this.body.includes('challenge')
          ) {
            return '<Payment id="123" />';
          }
          return this.body || '';
        }
      };
    }

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: MppxService,
          useValue: {
            mvxChargeMethod: { _method: 'charge' },
            mvxSessionMethod: { _method: 'session' },
            mvxSubscriptionMethod: { _method: 'subscription' },
            instance: {
              compose: jest.fn(),
            },
          },
        },
        {
          provide: RelayerService,
          useValue: {
            submitRelayedV3: jest.fn().mockResolvedValue('tx_hash_123'),
            getRelayerAddress: jest.fn().mockReturnValue('erd1relayer'),
          },
        },
        {
          provide: StorageService,
          useValue: {
            get: jest.fn(),
            save: jest.fn().mockResolvedValue(true),
          },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
    mppxService = app.get<MppxService>(MppxService);
    relayerService = app.get<RelayerService>(RelayerService);
    storageService = app.get<StorageService>(StorageService);
  });

  const mockReq = (url: string = '/test', method: string = 'GET') => {
    return {
      protocol: 'http',
      get: (header: string) => (header === 'host' ? 'localhost' : undefined),
      originalUrl: url,
      method,
      headers: {},
      query: {},
    } as unknown as Request;
  };

  const mockRes = () => {
    const res: any = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.send = jest.fn().mockReturnValue(res);
    res.setHeader = jest.fn();
    return res as unknown as Response;
  };

  describe('protected-resource', () => {
    it('should return 402 Payment Required if no valid payment is provided', async () => {
      const composeFn = jest.fn().mockResolvedValue({
        status: 402,
        challenge: {
          headers: new Map(),
          text: async () => 'Payment id="challenge-123"',
        },
      });
      (mppxService.instance.compose as jest.Mock).mockReturnValue(composeFn);

      const req = mockReq('/protected-resource');
      const res = mockRes();

      await appController.getProtectedResource(req, res);

      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/problem+json',
      );
    });

    it('should return 200 with resources if payment is valid', async () => {
      const composeFn = jest.fn().mockResolvedValue({
        status: 200,
        withReceipt: jest.fn().mockReturnValue({
          headers: new Map([['Validation', 'true']]),
          text: async () => 'Here is your protected data!',
        }),
      });
      (mppxService.instance.compose as jest.Mock).mockReturnValue(composeFn);

      const req = mockReq('/protected-resource');
      const res = mockRes();

      await appController.getProtectedResource(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith('Here is your protected data!');
    });
  });

  describe('session-resource', () => {
    it('should return 402 Payment Required for session', async () => {
      const composeFn = jest.fn().mockResolvedValue({
        status: 402,
        challenge: {
          headers: new Map(),
          text: async () => 'Payment id="challenge-session"',
        },
      });
      (mppxService.instance.compose as jest.Mock).mockReturnValue(composeFn);

      const req = mockReq('/session-resource');
      const res = mockRes();

      await appController.getSessionResource(req, res);

      expect(res.status).toHaveBeenCalledWith(402);
    });

    it('should return 200 for valid session', async () => {
      const composeFn = jest.fn().mockResolvedValue({
        status: 200,
        withReceipt: jest.fn().mockReturnValue({
          headers: new Map(),
          text: async () => 'Here is your continuous session data stream...',
        }),
      });
      (mppxService.instance.compose as jest.Mock).mockReturnValue(composeFn);

      const req = mockReq('/session-resource');
      const res = mockRes();

      await appController.getSessionResource(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith(
        'Here is your continuous session data stream...',
      );
    });
  });

  describe('subscription-resource', () => {
    it('should return 402 Payment Required for subscription', async () => {
      const composeFn = jest.fn().mockResolvedValue({
        status: 402,
        challenge: {
          headers: new Map(),
          text: async () => 'Payment id="challenge-sub"',
        },
      });
      (mppxService.instance.compose as jest.Mock).mockReturnValue(composeFn);

      const req = mockReq('/subscription-resource');
      const res = mockRes();

      await appController.getSubscriptionResource(req, res);

      expect(res.status).toHaveBeenCalledWith(402);
    });

    it('should return 200 for valid subscription', async () => {
      const composeFn = jest.fn().mockResolvedValue({
        status: 200,
        withReceipt: jest.fn().mockReturnValue({
          headers: new Map(),
          text: async () => 'Welcome to your premium subscription content!',
        }),
      });
      (mppxService.instance.compose as jest.Mock).mockReturnValue(composeFn);

      const req = mockReq('/subscription-resource');
      const res = mockRes();

      await appController.getSubscriptionResource(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith(
        'Welcome to your premium subscription content!',
      );
    });
  });

  describe('submit_relayed_v3', () => {
    it('should submit relayed v3 transaction successfully', async () => {
      const req = mockReq();
      req.ip = '127.0.0.1';
      const payload: any = { sender: 'erd1sender' };

      const result = await appController.submitRelayedV3(payload, req);
      expect(result).toEqual({ success: true, txHash: 'tx_hash_123' });
      expect(relayerService.submitRelayedV3).toHaveBeenCalledWith(payload);
    });

    it('should handle relayer exceptions', async () => {
      const req = mockReq();
      req.ip = '127.0.0.1';
      const payload: any = { sender: 'erd1fail' };
      (relayerService.submitRelayedV3 as jest.Mock).mockRejectedValueOnce(
        new Error('Relayer failed'),
      );

      await expect(appController.submitRelayedV3(payload, req)).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('getRelayerAddress', () => {
    it('should return the relayer address', () => {
      const result = appController.getRelayerAddress();
      expect(result).toEqual({ address: 'erd1relayer' });
    });

    it('should throw HTTP exception if relayer is not configured', () => {
      (relayerService.getRelayerAddress as jest.Mock).mockReturnValueOnce(
        undefined,
      );
      expect(() => appController.getRelayerAddress()).toThrow(HttpException);
    });
  });

  describe('createChallenge', () => {
    it('should create and save a new challenge', async () => {
      const body = {
        id: 'chall_123',
        receiver: 'erd1recv',
        amount: '100',
        currency: 'EGLD',
      };
      const result = await appController.createChallenge(body);
      expect(result).toEqual({ success: true, challengeId: 'chall_123' });
      expect(storageService.save).toHaveBeenCalled();
    });
  });

  describe('getChallenge', () => {
    it('should return the stored challenge details', async () => {
      const challenge = {
        id: 'chall_123',
        txHash: '',
        payer: '',
        receiver: 'erd1recv',
        amount: '100',
        currency: 'EGLD',
        chainId: 'D',
        status: 'pending',
        verificationAttempts: 2,
        lastVerificationAt: new Date('2026-04-09T12:30:00Z'),
        lastVerificationStatus: 'tx-pending',
        lastVerificationError: 'Transaction is still pending',
        lastObservedTxStatus: 'pending',
        lastVerificationTxHash: '0xabc',
        createdAt: new Date('2026-04-09T12:00:00Z'),
        updatedAt: new Date('2026-04-09T12:30:00Z'),
        expiresAt: null,
        opaque: null,
        digest: null,
        source: null,
      };
      (storageService.get as jest.Mock).mockResolvedValueOnce(challenge);

      await expect(appController.getChallenge('chall_123')).resolves.toEqual(
        challenge,
      );
    });

    it('should throw when the challenge does not exist', async () => {
      (storageService.get as jest.Mock).mockResolvedValueOnce(null);

      await expect(appController.getChallenge('missing')).rejects.toThrow(
        HttpException,
      );
    });
  });
});

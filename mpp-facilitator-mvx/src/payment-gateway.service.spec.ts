jest.mock('./mppx.service', () => ({
  MppxService: class MppxService {},
}));

jest.mock('./storage.service', () => ({
  StorageService: class StorageService {},
}));

import { PaymentGatewayService } from './payment-gateway.service';

describe('PaymentGatewayService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = {
      ...originalEnv,
      MPP_TOKEN_DECIMALS: '18',
      MPP_DEFAULT_CURRENCY: 'EGLD',
      MPP_CHAIN_ID: 'D',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function makeReq() {
    return {
      protocol: 'https',
      get: jest.fn().mockReturnValue('example.com'),
      originalUrl: '/intel/token-risk?token=ABC-123',
      method: 'GET',
      headers: {},
    } as any;
  }

  function makeRes() {
    return {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      type: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as any;
  }

  it('persists a challenge when the upstream compose flow returns 402', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const compose = jest.fn().mockReturnValue(async () => ({
      status: 402,
      challenge: new Response(JSON.stringify({ ok: false }), {
        status: 402,
        headers: {
          'WWW-Authenticate':
            'Payment id="challenge-402", expires="2026-03-30T12:00:00.000Z"',
        },
      }),
    }));

    const service = new PaymentGatewayService(
      {
        instance: { compose },
        mvxChargeMethod: { _method: 'mvx-charge' },
      } as any,
      { save } as any,
    );

    const onAuthorized = jest.fn();
    const req = makeReq();
    const res = makeRes();

    await service.handleCharge(req, res, {
      amount: '0.05',
      recipient: 'erd1receiver',
      digest: 'sha-256=:digest:',
      opaque: { resource: 'token-risk' },
      source: 'mx-alpha',
      onAuthorized,
    });

    expect(compose).toHaveBeenCalledWith([
      { _method: 'mvx-charge' },
      {
        amount: '0.05',
        recipient: 'erd1receiver',
        digest: 'sha-256=:digest:',
        meta: { resource: 'token-risk' },
      },
    ]);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'challenge-402',
        receiver: 'erd1receiver',
        amount: '50000000000000000',
        currency: 'EGLD',
        chainId: 'D',
        status: 'pending',
        digest: 'sha-256=:digest:',
        source: 'mx-alpha',
        opaque: JSON.stringify({ resource: 'token-risk' }),
      }),
    );
    expect(onAuthorized).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Payment Required',
        challengeId: 'challenge-402',
      }),
    );
  });

  it('returns the paid payload with a receipt header after a successful authorization', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const compose = jest.fn().mockReturnValue(async () => ({
      status: 200,
      withReceipt: (response: Response) =>
        new Response(response.body, {
          status: 200,
          headers: {
            'Content-Type': response.headers.get('Content-Type') || 'application/json',
            'Payment-Receipt': 'receipt-123',
          },
        }),
    }));

    const service = new PaymentGatewayService(
      {
        instance: { compose },
        mvxChargeMethod: { _method: 'mvx-charge' },
      } as any,
      { save } as any,
    );

    const req = makeReq();
    const res = makeRes();

    await service.handleCharge(req, res, {
      amount: '0.10',
      recipient: 'erd1receiver',
      onAuthorized: async () => ({ ok: true, report: 'wallet-profile' }),
    });

    expect(save).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('payment-receipt', 'receipt-123');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.type).toHaveBeenCalledWith('application/json');
    expect(res.send).toHaveBeenCalledWith(
      JSON.stringify({ ok: true, report: 'wallet-profile' }),
    );
  });
});

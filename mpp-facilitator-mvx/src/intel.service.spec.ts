import { IntelService } from './intel.service';

describe('IntelService', () => {
  let service: IntelService;
  const originalWegldSwapAddress = process.env.MPP_WEGLD_SWAP_ADDRESS;

  beforeEach(() => {
    service = new IntelService();
    delete process.env.MPP_WEGLD_SWAP_ADDRESS;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalWegldSwapAddress) {
      process.env.MPP_WEGLD_SWAP_ADDRESS = originalWegldSwapAddress;
    } else {
      delete process.env.MPP_WEGLD_SWAP_ADDRESS;
    }
  });

  it('builds a high-risk token report when privileged controls are enabled', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        name: 'Risky Token',
        ticker: 'RISK',
        canMint: true,
        canFreeze: true,
        canWipe: true,
        holders: 12,
        marketCap: '50000',
      }),
    } as Response);

    const report = await service.getTokenRisk('RISK-123');

    expect(report.risk.level).toBe('high');
    expect(report.risk.score).toBeGreaterThanOrEqual(70);
    expect(report.risk.signals.length).toBeGreaterThan(0);
  });

  it('builds a wallet profile with counterparties and labels', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          balance: '2000000000000000000000000000',
          txCount: 150,
          username: 'alpha-user',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          { sender: 'erd1foo', receiver: 'erd1wallet' },
          { sender: 'erd1wallet', receiver: 'erd1bar' },
          { sender: 'erd1foo', receiver: 'erd1wallet' },
        ],
      } as Response);

    const report = await service.getWalletProfile('erd1wallet');

    expect(report.profile.labels).toContain('named-account');
    expect(report.profile.labels).toContain('active');
    expect(report.profile.counterparties[0]).toEqual({
      address: 'erd1foo',
      interactions: 2,
    });
  });

  it('builds a swap simulation using EGLD as the direct pair asset', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          price: 40,
          marketCap: 1200000000,
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: 'USD Coin',
          ticker: 'USDC',
          decimals: 6,
          price: 1,
          marketCap: 500000000,
          holders: 10000,
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: 'EGLDUSDC-594e5e',
            address: 'erd1pair',
            state: 'active',
            exchange: 'xexchange',
            baseId: 'WEGLD-bd4d79',
            quoteId: 'USDC-c76f1f',
            totalValue: 1500000,
            volume24h: 80000,
          },
        ],
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: 'WrappedEGLD',
          ticker: 'WEGLD',
          decimals: 18,
          price: 3.8,
          marketCap: 2000000,
        }),
      } as Response);

    const report = await service.getSwapSimulation('EGLD', 'USDC-c76f1f', '2');

    expect(report.route.path).toEqual(['EGLD', 'USDC-c76f1f']);
    expect(report.route.mode).toBe('direct');
    expect(report.route.pairs[0]).toEqual(
      expect.objectContaining({
        id: 'EGLDUSDC-594e5e',
        baseId: 'WEGLD-bd4d79',
        quoteId: 'USDC-c76f1f',
      }),
    );
    expect(report.quote.estimatedInputUsd).toBe(80);
    expect(Number(report.quote.estimatedOutputAmount)).toBeGreaterThan(70);
    expect(report.quote.pricingSource).toBe('xexchange-mex');
    expect(report.execution.confidence).toBe('high');
  });

  it('builds a swap execution plan with pair actions and min-output amounts', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: 'WrappedUSDC',
          ticker: 'USDC',
          decimals: 6,
          price: 1,
          marketCap: 9000000,
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: 'holoride',
          ticker: 'RIDE',
          decimals: 18,
          price: 0.00025,
          marketCap: 200000,
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: 'EGLDUSDC-594e5e',
            address: 'erd1pair-usdc',
            state: 'active',
            exchange: 'xexchange',
            baseId: 'WEGLD-bd4d79',
            quoteId: 'USDC-c76f1f',
            totalValue: 1600000,
            volume24h: 70000,
          },
          {
            id: 'EGLDRIDE-7bd51a',
            address: 'erd1pair-ride',
            state: 'active',
            exchange: 'xexchange',
            baseId: 'RIDE-7d18e9',
            quoteId: 'WEGLD-bd4d79',
            totalValue: 25000,
            volume24h: 100,
          },
        ],
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: 'WrappedEGLD',
          ticker: 'WEGLD',
          decimals: 18,
          price: 40,
          marketCap: 1200000000,
        }),
      } as Response);

    const report = await service.getSwapExecutionPlan('USDC-c76f1f', 'RIDE-7d18e9', '25');

    expect(report.executionPlan.strategy).toBe('xexchange-pair-sequence');
    expect(report.executionPlan.actions).toHaveLength(2);
    expect(report.executionPlan.actions[0]).toEqual(
      expect.objectContaining({
        type: 'swap-fixed-input',
        pairId: 'EGLDUSDC-594e5e',
        tokenIn: 'USDC-c76f1f',
        transactionTemplate: expect.objectContaining({
          kind: 'smart-contract-execute',
          function: 'swapTokensFixedInput',
          receiver: 'erd1pair-usdc',
        }),
      }),
    );
    expect(report.executionPlan.actions[1]).toEqual(
      expect.objectContaining({
        type: 'swap-fixed-input',
        pairId: 'EGLDRIDE-7bd51a',
        tokenOut: 'RIDE-7d18e9',
      }),
    );
    expect(report.executionPlan.chainId).toBe('D');
    expect(report.executionPlan.minOutput.smallestUnit).toMatch(/^\d+$/);
    expect(report.simulation.quote.pricingSource).toBe('xexchange-mex');
  });

  it('adds a wrap template for EGLD routes when a WEGLD swap address is configured', async () => {
    process.env.MPP_WEGLD_SWAP_ADDRESS =
      'erd1qqqqqqqqqqqqqpgq4axqc749vuqr27snr8d8qgvlmz44chsr0n4sm4a72g';

    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          price: 40,
          marketCap: 1200000000,
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: 'USD Coin',
          ticker: 'USDC',
          decimals: 6,
          price: 1,
          marketCap: 500000000,
          holders: 10000,
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: 'EGLDUSDC-594e5e',
            address: 'erd1pair-usdc',
            state: 'active',
            exchange: 'xexchange',
            baseId: 'WEGLD-bd4d79',
            quoteId: 'USDC-c76f1f',
            totalValue: 1500000,
            volume24h: 80000,
          },
        ],
      } as Response);

    const report = await service.getSwapExecutionPlan('EGLD', 'USDC-c76f1f', '2');
    const [wrapAction] = report.executionPlan.actions;

    expect(wrapAction).toEqual(
      expect.objectContaining({
        type: 'wrap-egld',
        transactionTemplate: expect.objectContaining({
          receiver:
            'erd1qqqqqqqqqqqqqpgq4axqc749vuqr27snr8d8qgvlmz44chsr0n4sm4a72g',
          function: 'wrapEgld',
          nativeTransferAmount: '2000000000000000000',
        }),
      }),
    );
  });

  it('adds an unwrap template for EGLD destinations when a WEGLD swap address is configured', async () => {
    process.env.MPP_WEGLD_SWAP_ADDRESS =
      'erd1qqqqqqqqqqqqqpgq4axqc749vuqr27snr8d8qgvlmz44chsr0n4sm4a72g';

    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: 'WrappedUSDC',
          ticker: 'USDC',
          decimals: 6,
          price: 1,
          marketCap: 9000000,
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          price: 40,
          marketCap: 1200000000,
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: 'EGLDUSDC-594e5e',
            address: 'erd1pair-usdc',
            state: 'active',
            exchange: 'xexchange',
            baseId: 'WEGLD-bd4d79',
            quoteId: 'USDC-c76f1f',
            totalValue: 1500000,
            volume24h: 80000,
          },
        ],
      } as Response);

    const report = await service.getSwapExecutionPlan('USDC-c76f1f', 'EGLD', '25');
    const unwrapAction = report.executionPlan.actions[report.executionPlan.actions.length - 1];

    expect(unwrapAction).toEqual(
      expect.objectContaining({
        type: 'unwrap-egld',
        transactionTemplate: expect.objectContaining({
          receiver:
            'erd1qqqqqqqqqqqqqpgq4axqc749vuqr27snr8d8qgvlmz44chsr0n4sm4a72g',
          function: 'unwrapEgld',
        }),
      }),
    );
  });
});

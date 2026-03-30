import {
  BadRequestException,
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

type JsonRecord = Record<string, unknown>;

type AssetInfo = {
  identifier: string;
  name: string;
  ticker: string;
  decimals: number;
  priceUsd: number;
  marketCapUsd: number | null;
  holders: number | null;
  dexIdentifier: string;
};

type MexPair = {
  id: string;
  address: string;
  state: string;
  exchange: string;
  baseId: string;
  quoteId: string;
  totalValue: number | string | null;
  volume24h?: number | string | null;
};

type MexRoute = {
  path: string[];
  hops: number;
  mode: 'same-asset' | 'direct' | 'bridge';
  pairs: Array<{
    id: string;
    address: string;
    exchange: string;
    baseId: string;
    quoteId: string;
    liquidityUsd: number | null;
    volume24hUsd: number | null;
  }>;
  liquidityUsd: number | null;
};

type SwapSimulation = {
  request: {
    from: string;
    to: string;
    amount: string;
  };
  route: {
    path: string[];
    hops: number;
    mode: 'same-asset' | 'direct' | 'bridge';
    pairs?: MexRoute['pairs'];
    liquidityUsd?: number | null;
  };
  quote: {
    estimatedInputUsd: number;
    estimatedOutputAmount: string;
    estimatedOutputUsd: number;
    estimatedRate: string;
    feePercent: number;
    priceImpactPercent: number;
    totalSlippagePercent: number;
    pricingSource: 'xexchange-mex' | 'public-token-metadata';
  };
  market: {
    fromAsset: AssetInfo;
    toAsset: AssetInfo;
  };
  execution: {
    confidence: 'low' | 'medium' | 'high';
    notes: string[];
  };
  generatedAt: string;
};

type ActionAmountReference = {
  kind: 'previous-action-output';
  actionIndex: number;
  outputToken: string;
  fallbackAmount: string;
};

@Injectable()
export class IntelService {
  private readonly apiBaseUrl =
    process.env.MVX_ANALYTICS_API_URL ||
    process.env.MVX_API_URL ||
    'https://api.multiversx.com';
  private readonly mexBridgeAsset = 'WEGLD-bd4d79';
  private mexPairsCache:
    | {
        expiresAt: number;
        value: MexPair[];
      }
    | undefined;

  async getTokenRisk(identifier: string) {
    const token = await this.fetchJson<JsonRecord>(`/tokens/${identifier}`, true);
    const riskSignals = this.buildTokenSignals(token);
    const holders = this.toNumber(token.holders);
    const circulatingSupply = this.toStringValue(
      token.circulatingSupply ?? token.supply,
    );

    return {
      token: {
        identifier,
        name: this.toStringValue(token.name) || identifier,
        ticker: this.toStringValue(token.ticker) || identifier,
        type: this.toStringValue(token.type) || 'unknown',
      },
      risk: {
        score: riskSignals.score,
        level: this.riskLevel(riskSignals.score),
        summary: riskSignals.summary,
        signals: riskSignals.signals,
      },
      market: {
        priceUsd: this.toNumber(token.price),
        marketCapUsd: this.toNumber(token.marketCap),
        holders,
        circulatingSupply,
      },
      controls: {
        canMint: this.toBoolean(token.canMint),
        canBurn: this.toBoolean(token.canBurn),
        canPause: this.toBoolean(token.canPause),
        canFreeze: this.toBoolean(token.canFreeze),
        canWipe: this.toBoolean(token.canWipe),
      },
      generatedAt: new Date().toISOString(),
    };
  }

  async getWalletProfile(address: string) {
    const [accountResult, transactionsResult] = await Promise.allSettled([
      this.fetchJson<JsonRecord>(`/accounts/${address}`, true),
      this.fetchJson<JsonRecord[]>(
        `/accounts/${address}/transactions?from=0&size=25&status=success`,
        false,
      ),
    ]);

    if (accountResult.status !== 'fulfilled') {
      throw accountResult.reason;
    }

    const account = accountResult.value;
    const transactions =
      transactionsResult.status === 'fulfilled' ? transactionsResult.value : [];
    const labels = this.buildWalletLabels(account, transactions);
    const counterparties = this.topCounterparties(address, transactions);

    return {
      wallet: {
        address,
        username: this.toStringValue(account.username),
        balance: this.toStringValue(account.balance) || '0',
        nonce: this.toNumber(account.nonce),
        transactionCount: this.toNumber(account.txCount),
        hasCode: Boolean(account.code),
        isGuarded: this.toBoolean(account.isGuarded),
      },
      profile: {
        labels,
        kind: Boolean(account.code) ? 'smart-contract' : 'externally-owned-account',
        activityBand: this.activityBand(this.toNumber(account.txCount)),
        counterparties,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  async getSwapSimulation(fromIdentifier: string, toIdentifier: string, amount: string) {
    const normalizedAmount = this.parsePositiveAmount(amount);
    const [fromAsset, toAsset] = await Promise.all([
      this.fetchAsset(fromIdentifier),
      this.fetchAsset(toIdentifier),
    ]);
    const mexRoute = await this.findMexRoute(fromAsset, toAsset);
    const route = mexRoute || this.buildSwapRoute(fromAsset.identifier, toAsset.identifier);
    const estimatedInputUsd = normalizedAmount * fromAsset.priceUsd;
    const feePercent = route.mode === 'same-asset' ? 0 : route.hops * 0.3;
    const priceImpactPercent =
      route.mode === 'same-asset'
        ? 0
        : mexRoute
          ? this.estimateDexPriceImpactPercent({
              routeHops: route.hops,
              inputUsd: estimatedInputUsd,
              routeLiquidityUsd: mexRoute.liquidityUsd,
              volume24hUsd: mexRoute.pairs
                .map((pair) => pair.volume24hUsd)
                .filter((value): value is number => value !== null)
                .sort((left, right) => left - right)[0] ?? null,
            })
          : this.estimatePriceImpactPercent({
              routeHops: route.hops,
              inputUsd: estimatedInputUsd,
              fromMarketCapUsd: fromAsset.marketCapUsd,
              toMarketCapUsd: toAsset.marketCapUsd,
              fromHolders: fromAsset.holders,
              toHolders: toAsset.holders,
            });
    const totalSlippagePercent = feePercent + priceImpactPercent;
    const grossOutputAmount = estimatedInputUsd / toAsset.priceUsd;
    const netOutputAmount = grossOutputAmount * (1 - totalSlippagePercent / 100);

    return {
      request: {
        from: fromAsset.identifier,
        to: toAsset.identifier,
        amount,
      },
      route,
      quote: {
        estimatedInputUsd: this.roundNumber(estimatedInputUsd),
        estimatedOutputAmount: this.formatDecimal(netOutputAmount),
        estimatedOutputUsd: this.roundNumber(netOutputAmount * toAsset.priceUsd),
        estimatedRate: this.formatDecimal(netOutputAmount / normalizedAmount),
        feePercent: this.roundNumber(feePercent),
        priceImpactPercent: this.roundNumber(priceImpactPercent),
        totalSlippagePercent: this.roundNumber(totalSlippagePercent),
        pricingSource: mexRoute ? 'xexchange-mex' : 'public-token-metadata',
      },
      market: {
        fromAsset,
        toAsset,
      },
      execution: {
        confidence: this.executionConfidence(priceImpactPercent, route.hops),
        notes: [
          mexRoute
            ? 'Estimate is anchored to live xExchange pair metadata and public token pricing, but it is still not a signed router quote.'
            : 'Estimate is derived from public token pricing and metadata, not a live router quote.',
          route.mode === 'same-asset'
            ? 'Same-asset simulation assumes no execution fee or slippage.'
            : route.hops === 1
            ? mexRoute
              ? 'Route uses a live direct xExchange pool for this asset pair.'
              : 'Route assumes direct execution because one side is EGLD.'
            : 'Route assumes EGLD as the bridge asset for non-native pairs.',
          ...(mexRoute
            ? [
                `xExchange route liquidity floor was estimated from ${this.formatDecimal(
                  mexRoute.liquidityUsd || 0,
                )} USD of pool value.`,
              ]
            : []),
          ...(!mexRoute &&
          (fromAsset.marketCapUsd === null || toAsset.marketCapUsd === null)
            ? ['Liquidity heuristics fell back to holder-count and route-based estimates because market cap data was incomplete.']
            : []),
        ],
      },
      generatedAt: new Date().toISOString(),
    };
  }

  async getSwapExecutionPlan(
    fromIdentifier: string,
    toIdentifier: string,
    amount: string,
  ) {
    const simulation = (await this.getSwapSimulation(
      fromIdentifier,
      toIdentifier,
      amount,
    )) as SwapSimulation;

    return {
      simulation,
      executionPlan: await this.buildSwapExecutionPlan(simulation),
      generatedAt: new Date().toISOString(),
    };
  }

  private buildTokenSignals(token: JsonRecord) {
    let score = 20;
    const signals: string[] = [];

    if (this.toBoolean(token.canMint)) {
      score += 25;
      signals.push('Token supply can still be minted by a privileged actor.');
    }
    if (this.toBoolean(token.canFreeze)) {
      score += 15;
      signals.push('Accounts can be frozen by token control logic.');
    }
    if (this.toBoolean(token.canWipe)) {
      score += 15;
      signals.push('Token balances can be wiped by a privileged actor.');
    }
    if (this.toBoolean(token.canPause) || this.toBoolean(token.isPaused)) {
      score += 10;
      signals.push('Transfers can be paused, which increases operator control risk.');
    }

    const holders = this.toNumber(token.holders);
    if (holders !== null && holders < 100) {
      score += 20;
      signals.push('Holder count is still low, so distribution looks concentrated.');
    } else if (holders !== null && holders > 1000) {
      score -= 10;
      signals.push('Broader holder base slightly reduces concentration risk.');
    }

    const marketCap = this.toNumber(token.marketCap);
    if (marketCap !== null && marketCap < 100_000) {
      score += 10;
      signals.push('Very small market capitalization suggests elevated liquidity risk.');
    }

    score = Math.max(0, Math.min(100, score));

    return {
      score,
      signals,
      summary:
        signals[0] ||
        'No major privilege or distribution red flags were detected from public token metadata.',
    };
  }

  private buildWalletLabels(
    account: JsonRecord,
    transactions: JsonRecord[],
  ): string[] {
    const labels: string[] = [];
    const txCount = this.toNumber(account.txCount) || 0;

    if (account.username) {
      labels.push('named-account');
    }
    if (account.code) {
      labels.push('smart-contract');
    } else {
      labels.push('user-wallet');
    }
    if ((this.toBigInt(account.balance) || 0n) >= 1_000_000_000_000_000_000_000_000_000n) {
      labels.push('whale');
    }
    if (txCount >= 1_000) {
      labels.push('power-user');
    } else if (txCount >= 100) {
      labels.push('active');
    } else if (txCount > 0) {
      labels.push('light-activity');
    } else {
      labels.push('new-or-dormant');
    }
    if (transactions.some((tx) => this.toStringValue(tx.function) !== null)) {
      labels.push('contract-caller');
    }

    return labels;
  }

  private topCounterparties(
    address: string,
    transactions: JsonRecord[],
  ): Array<{ address: string; interactions: number }> {
    const counts = new Map<string, number>();

    for (const tx of transactions) {
      const sender = this.toStringValue(tx.sender);
      const receiver = this.toStringValue(tx.receiver);
      const counterparty =
        sender && sender !== address ? sender : receiver && receiver !== address ? receiver : null;

      if (counterparty) {
        counts.set(counterparty, (counts.get(counterparty) || 0) + 1);
      }
    }

    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([counterparty, interactions]) => ({
        address: counterparty,
        interactions,
      }));
  }

  private activityBand(txCount: number | null): string {
    if (txCount === null) return 'unknown';
    if (txCount >= 1000) return 'high';
    if (txCount >= 100) return 'medium';
    if (txCount > 0) return 'low';
    return 'none';
  }

  private riskLevel(score: number): 'low' | 'medium' | 'high' {
    if (score >= 70) return 'high';
    if (score >= 40) return 'medium';
    return 'low';
  }

  private async fetchAsset(identifier: string) {
    if (identifier === 'EGLD') {
      const economics = await this.fetchJson<JsonRecord>('/economics', true);
      const priceUsd = this.toNumber(economics.price);
      if (priceUsd === null || priceUsd <= 0) {
        throw new BadGatewayException('Unable to derive a USD price for EGLD');
      }

      return {
        identifier: 'EGLD',
        name: 'MultiversX eGold',
        ticker: 'EGLD',
        decimals: 18,
        priceUsd,
        marketCapUsd: this.toNumber(economics.marketCap),
        holders: null as number | null,
        dexIdentifier: this.mexBridgeAsset,
      } satisfies AssetInfo;
    }

    const token = await this.fetchJson<JsonRecord>(`/tokens/${identifier}`, true);
    const priceUsd = this.toNumber(token.price);
    if (priceUsd === null || priceUsd <= 0) {
      throw new BadGatewayException(
        `Unable to derive a USD price for token ${identifier}`,
      );
    }

    return {
      identifier,
      name: this.toStringValue(token.name) || identifier,
      ticker: this.toStringValue(token.ticker) || identifier,
      decimals: this.toNumber(token.decimals) || 18,
      priceUsd,
      marketCapUsd: this.toNumber(token.marketCap),
      holders: this.toNumber(token.holders),
      dexIdentifier: identifier,
    } satisfies AssetInfo;
  }

  private buildSwapRoute(from: string, to: string) {
    if (from === to) {
      return {
        path: [from],
        hops: 0,
        mode: 'same-asset',
      };
    }

    if (from === 'EGLD' || to === 'EGLD') {
      return {
        path: [from, to],
        hops: 1,
        mode: 'direct',
      };
    }

    return {
      path: [from, 'EGLD', to],
      hops: 2,
      mode: 'bridge',
    };
  }

  private async findMexRoute(
    fromAsset: AssetInfo,
    toAsset: AssetInfo,
  ): Promise<MexRoute | null> {
    if (fromAsset.identifier === toAsset.identifier) {
      return {
        path: [fromAsset.identifier],
        hops: 0,
        mode: 'same-asset',
        pairs: [],
        liquidityUsd: null,
      };
    }

    try {
      const pairs = await this.fetchMexPairs();
      const directPair = this.findBestPair(
        pairs,
        fromAsset.dexIdentifier,
        toAsset.dexIdentifier,
      );

      if (directPair) {
        return {
          path: [fromAsset.identifier, toAsset.identifier],
          hops: 1,
          mode: 'direct',
          pairs: [this.toRoutePair(directPair)],
          liquidityUsd: this.toNumber(directPair.totalValue),
        };
      }

      const firstBridgePair = this.findBestPair(
        pairs,
        fromAsset.dexIdentifier,
        this.mexBridgeAsset,
      );
      const secondBridgePair = this.findBestPair(
        pairs,
        this.mexBridgeAsset,
        toAsset.dexIdentifier,
      );

      if (!firstBridgePair || !secondBridgePair) {
        return null;
      }

      const firstLiquidity = this.toNumber(firstBridgePair.totalValue);
      const secondLiquidity = this.toNumber(secondBridgePair.totalValue);

      return {
        path: [fromAsset.identifier, this.mexBridgeAsset, toAsset.identifier],
        hops: 2,
        mode: 'bridge',
        pairs: [
          this.toRoutePair(firstBridgePair),
          this.toRoutePair(secondBridgePair),
        ],
        liquidityUsd: [firstLiquidity, secondLiquidity]
          .filter((value): value is number => value !== null)
          .sort((left, right) => left - right)[0] ?? null,
      };
    } catch {
      return null;
    }
  }

  private async fetchMexPairs(): Promise<MexPair[]> {
    if (this.mexPairsCache && this.mexPairsCache.expiresAt > Date.now()) {
      return this.mexPairsCache.value;
    }

    const pairs = await this.fetchJson<MexPair[]>(
      '/mex/pairs?from=0&size=1000',
      false,
    );
    const activePairs = pairs.filter(
      (pair) => pair.state === 'active' && pair.exchange === 'xexchange',
    );

    this.mexPairsCache = {
      expiresAt: Date.now() + 30_000,
      value: activePairs,
    };

    return activePairs;
  }

  private findBestPair(
    pairs: MexPair[],
    leftAsset: string,
    rightAsset: string,
  ): MexPair | null {
    const matches = pairs.filter(
      (pair) =>
        (pair.baseId === leftAsset && pair.quoteId === rightAsset) ||
        (pair.baseId === rightAsset && pair.quoteId === leftAsset),
    );

    if (matches.length === 0) {
      return null;
    }

    return matches.sort(
      (left, right) =>
        (this.toNumber(right.totalValue) || 0) - (this.toNumber(left.totalValue) || 0),
    )[0];
  }

  private toRoutePair(pair: MexPair) {
    return {
      id: pair.id,
      address: pair.address,
      exchange: pair.exchange,
      baseId: pair.baseId,
      quoteId: pair.quoteId,
      liquidityUsd: this.toNumber(pair.totalValue),
      volume24hUsd: this.toNumber(pair.volume24h),
    };
  }

  private estimatePriceImpactPercent(parameters: {
    routeHops: number;
    inputUsd: number;
    fromMarketCapUsd: number | null;
    toMarketCapUsd: number | null;
    fromHolders: number | null;
    toHolders: number | null;
  }): number {
    const {
      routeHops,
      inputUsd,
      fromMarketCapUsd,
      toMarketCapUsd,
      fromHolders,
      toHolders,
    } = parameters;

    const liquidityProxyBase = [fromMarketCapUsd, toMarketCapUsd]
      .filter((value): value is number => value !== null && value > 0)
      .sort((left, right) => left - right)[0];
    const liquidityProxyUsd =
      liquidityProxyBase !== undefined
        ? Math.max(liquidityProxyBase * 0.01, 25_000)
        : 50_000;
    const sizeRatio = inputUsd / liquidityProxyUsd;
    let impact = routeHops * 0.35 + Math.max(0.15, sizeRatio * 100);

    const concentrationPenalty =
      (fromHolders !== null && fromHolders < 250 ? 0.75 : 0) +
      (toHolders !== null && toHolders < 250 ? 0.75 : 0);

    impact += concentrationPenalty;

    return Math.min(25, this.roundNumber(impact));
  }

  private estimateDexPriceImpactPercent(parameters: {
    routeHops: number;
    inputUsd: number;
    routeLiquidityUsd: number | null;
    volume24hUsd: number | null;
  }): number {
    const liquidityUsd =
      parameters.routeLiquidityUsd !== null && parameters.routeLiquidityUsd > 0
        ? parameters.routeLiquidityUsd
        : 25_000;
    const effectiveLiquidity = Math.max(liquidityUsd * 0.5, 1_000);
    let impact =
      parameters.routeHops * 0.05 +
      Math.max(0.03, Math.sqrt(parameters.inputUsd / effectiveLiquidity) * 10);

    if (liquidityUsd < 50_000) {
      impact += 0.75;
    }
    if (liquidityUsd < 10_000) {
      impact += 1.5;
    }
    if (parameters.volume24hUsd !== null && parameters.volume24hUsd < 10_000) {
      impact += 0.2;
    }

    return Math.min(20, this.roundNumber(impact));
  }

  private executionConfidence(
    priceImpactPercent: number,
    routeHops: number,
  ): 'low' | 'medium' | 'high' {
    if (priceImpactPercent <= 1.5 && routeHops <= 1) return 'high';
    if (priceImpactPercent <= 4) return 'medium';
    return 'low';
  }

  private async buildSwapExecutionPlan(simulation: SwapSimulation) {
    const fromAsset = simulation.market.fromAsset;
    const toAsset = simulation.market.toAsset;
    const routePairs = simulation.route.pairs || [];
    const slippageBps = this.suggestSlippageBps(
      simulation.quote.totalSlippagePercent,
      simulation.execution.confidence,
    );
    const estimatedOutputHuman = simulation.quote.estimatedOutputAmount;
    const minOutputHuman = this.applySlippageBps(
      estimatedOutputHuman,
      slippageBps,
    );
    const actions: Array<Record<string, unknown>> = [];
    const warnings: string[] = [];
    let currentToken = fromAsset.dexIdentifier;

    if (simulation.route.mode === 'same-asset') {
      return {
        strategy: 'no-op',
        chainId: this.chainId(),
        slippageBpsSuggested: 0,
        deadlineSecondsSuggested: 0,
        inputAmount: {
          human: simulation.request.amount,
          smallestUnit: this.decimalToBaseUnits(
            simulation.request.amount,
            fromAsset.decimals,
          ),
          token: fromAsset.identifier,
        },
        estimatedOutput: {
          human: estimatedOutputHuman,
          smallestUnit: this.decimalToBaseUnits(
            estimatedOutputHuman,
            toAsset.decimals,
          ),
          token: toAsset.identifier,
        },
        minOutput: {
          human: estimatedOutputHuman,
          smallestUnit: this.decimalToBaseUnits(
            estimatedOutputHuman,
            toAsset.decimals,
          ),
          token: toAsset.identifier,
        },
        actions,
        warnings: [
          'No swap is required because the input and output assets are identical.',
          ...warnings,
        ],
      };
    }

    if (
      (fromAsset.identifier === 'EGLD' || toAsset.identifier === 'EGLD') &&
      !this.wegldSwapAddress()
    ) {
      warnings.push(
        'Set MPP_WEGLD_SWAP_ADDRESS to attach executable wrap/unwrap templates for EGLD routes.',
      );
    }

    if (fromAsset.identifier === 'EGLD') {
      const wrapAmountSmallestUnit = this.decimalToBaseUnits(
        simulation.request.amount,
        18,
      );
      const wrapTemplate = this.buildWrapEgldTemplate({
        amountSmallestUnit: wrapAmountSmallestUnit,
      });

      actions.push({
        type: 'wrap-egld',
        tokenIn: 'EGLD',
        tokenOut: this.mexBridgeAsset,
        amountIn: simulation.request.amount,
        amountInSmallestUnit: wrapAmountSmallestUnit,
        outputAmountSmallestUnit: wrapAmountSmallestUnit,
        ...(wrapTemplate ? { transactionTemplate: wrapTemplate } : {}),
        note: 'Wrap EGLD to WEGLD before interacting with xExchange pair contracts.',
      });
      currentToken = this.mexBridgeAsset;
    }

    if (routePairs.length === 0) {
      return {
        strategy: 'advisory-only',
        chainId: this.chainId(),
        slippageBpsSuggested: slippageBps,
        deadlineSecondsSuggested: 600,
        inputAmount: {
          human: simulation.request.amount,
          smallestUnit: this.decimalToBaseUnits(
            simulation.request.amount,
            fromAsset.decimals,
          ),
          token: fromAsset.identifier,
        },
        estimatedOutput: {
          human: estimatedOutputHuman,
          smallestUnit: this.decimalToBaseUnits(
            estimatedOutputHuman,
            toAsset.decimals,
          ),
          token: toAsset.identifier,
        },
        minOutput: {
          human: minOutputHuman,
          smallestUnit: this.decimalToBaseUnits(minOutputHuman, toAsset.decimals),
          token: toAsset.identifier,
        },
        actions,
        warnings: [
          'No active xExchange pair route was found, so this plan is advisory only.',
          'Use the simulation output for manual review before attempting execution.',
          ...warnings,
        ],
      };
    }

    const estimatedIntermediateAmounts = await this.estimateRouteTokenAmounts(
      simulation,
    );

    routePairs.forEach((pair, index) => {
      const tokenIn = currentToken;
      const tokenOut =
        pair.baseId === tokenIn
          ? pair.quoteId
          : pair.quoteId === tokenIn
            ? pair.baseId
            : pair.quoteId;

      const expectedAmountOut =
        estimatedIntermediateAmounts[index + 1] || estimatedOutputHuman;
      const minAmountOut =
        index === routePairs.length - 1
          ? minOutputHuman
          : this.applySlippageBps(
              expectedAmountOut,
              Math.max(50, Math.floor(slippageBps / routePairs.length)),
            );
      const actionInputAmountSmallestUnit =
        estimatedIntermediateAmounts[index] !== undefined
          ? this.decimalToBaseUnits(
              estimatedIntermediateAmounts[index],
              this.decimalsForToken(tokenIn, simulation),
            )
          : '0';
      const minAmountOutSmallestUnit = this.decimalToBaseUnits(
        minAmountOut,
        this.decimalsForToken(tokenOut, simulation),
      );
      const amountReference = this.previousActionOutputReference(actions, tokenIn);

      actions.push({
        type: 'swap-fixed-input',
        pairId: pair.id,
        pairAddress: pair.address,
        exchange: pair.exchange,
        tokenIn,
        tokenOut,
        amountIn:
          estimatedIntermediateAmounts[index] ||
          (index === 0 ? simulation.request.amount : undefined),
        amountInSmallestUnit:
          estimatedIntermediateAmounts[index] !== undefined
            ? actionInputAmountSmallestUnit
            : undefined,
        minAmountOut,
        minAmountOutSmallestUnit,
        estimatedOutputAmountSmallestUnit: this.decimalToBaseUnits(
          expectedAmountOut,
          this.decimalsForToken(tokenOut, simulation),
        ),
        functionHint: 'swap-fixed-input',
        transactionTemplate: this.buildSwapFixedInputTemplate({
          pairAddress: pair.address,
          tokenIn,
          tokenInAmountSmallestUnit: actionInputAmountSmallestUnit,
          tokenOut,
          minAmountOutSmallestUnit,
          amountReference,
        }),
        note: 'Execute against the xExchange pair contract for this hop.',
      });

      currentToken = tokenOut;
    });

    if (toAsset.identifier === 'EGLD' && currentToken === this.mexBridgeAsset) {
      const amountReference = this.previousActionOutputReference(
        actions,
        this.mexBridgeAsset,
      );
      const unwrapTemplate = this.buildUnwrapEgldTemplate({
        amountSmallestUnit: this.decimalToBaseUnits(minOutputHuman, 18),
        amountReference,
      });

      actions.push({
        type: 'unwrap-egld',
        tokenIn: this.mexBridgeAsset,
        tokenOut: 'EGLD',
        minAmountOut: minOutputHuman,
        minAmountOutSmallestUnit: this.decimalToBaseUnits(minOutputHuman, 18),
        ...(amountReference ? { amountReference } : {}),
        ...(unwrapTemplate ? { transactionTemplate: unwrapTemplate } : {}),
        note: unwrapTemplate
          ? 'Unwrap the guaranteed minimum WEGLD back to EGLD after the final pair swap.'
          : 'Unwrap WEGLD back to EGLD after the final pair swap.',
      });
    }

    return {
      strategy:
        simulation.quote.pricingSource === 'xexchange-mex'
          ? 'xexchange-pair-sequence'
          : 'advisory-only',
      chainId: this.chainId(),
      slippageBpsSuggested: slippageBps,
      deadlineSecondsSuggested: 600,
      inputAmount: {
        human: simulation.request.amount,
        smallestUnit: this.decimalToBaseUnits(
          simulation.request.amount,
          fromAsset.decimals,
        ),
        token: fromAsset.identifier,
      },
      estimatedOutput: {
        human: estimatedOutputHuman,
        smallestUnit: this.decimalToBaseUnits(
          estimatedOutputHuman,
          toAsset.decimals,
        ),
        token: toAsset.identifier,
      },
      minOutput: {
        human: minOutputHuman,
        smallestUnit: this.decimalToBaseUnits(minOutputHuman, toAsset.decimals),
        token: toAsset.identifier,
      },
      actions,
      warnings: [
        'This plan is intended for fixed-input execution and still requires wallet or agent signing.',
        ...(simulation.quote.pricingSource === 'xexchange-mex'
          ? []
          : ['Pair-specific execution data was not available, so review the route before execution.']),
        ...warnings,
      ],
    };
  }

  private async fetchJson<T>(path: string, failOnMissing: boolean): Promise<T> {
    const url = `${this.apiBaseUrl}${path}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: 'application/json' },
    });

    if (response.status === 404 && failOnMissing) {
      throw new NotFoundException(`Resource not found at ${path}`);
    }
    if (!response.ok) {
      throw new BadGatewayException(
        `MultiversX API request failed with status ${response.status}`,
      );
    }

    return (await response.json()) as T;
  }

  private toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private toBoolean(value: unknown): boolean {
    return value === true || value === 'true';
  }

  private toStringValue(value: unknown): string | null {
    return typeof value === 'string' && value.trim() !== '' ? value : null;
  }

  private toBigInt(value: unknown): bigint | null {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'string' && value.trim() !== '') {
      try {
        return BigInt(value);
      } catch {
        return null;
      }
    }
    return null;
  }

  private parsePositiveAmount(value: string): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new BadRequestException('Swap amount must be a positive decimal value');
    }
    return parsed;
  }

  private roundNumber(value: number): number {
    return Number(value.toFixed(6));
  }

  private formatDecimal(value: number): string {
    if (!Number.isFinite(value)) return '0';
    if (Math.abs(value) >= 1) return value.toFixed(6).replace(/\.?0+$/, '');
    return value.toFixed(12).replace(/\.?0+$/, '');
  }

  private suggestSlippageBps(
    totalSlippagePercent: number,
    confidence: 'low' | 'medium' | 'high',
  ): number {
    const baseBps = Math.ceil(totalSlippagePercent * 100);
    const buffer =
      confidence === 'high' ? 50 : confidence === 'medium' ? 100 : 200;

    return Math.min(1500, Math.max(100, baseBps + buffer));
  }

  private applySlippageBps(amount: string, slippageBps: number): string {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return '0';
    }

    return this.formatDecimal(parsed * (1 - slippageBps / 10_000));
  }

  private decimalsForToken(token: string, simulation: SwapSimulation): number {
    if (
      token === simulation.market.fromAsset.identifier ||
      token === simulation.market.fromAsset.dexIdentifier
    ) {
      return simulation.market.fromAsset.decimals;
    }

    if (
      token === simulation.market.toAsset.identifier ||
      token === simulation.market.toAsset.dexIdentifier
    ) {
      return simulation.market.toAsset.decimals;
    }

    if (token === this.mexBridgeAsset) {
      return 18;
    }

    return 18;
  }

  private async estimateRouteTokenAmounts(
    simulation: SwapSimulation,
  ): Promise<string[]> {
    const tokens = this.routeTokens(simulation);

    if (tokens.length <= 1) {
      return [simulation.request.amount];
    }

    const outputAmount = Number(simulation.quote.estimatedOutputAmount);
    const inputAmount = Number(simulation.request.amount);
    if (!Number.isFinite(inputAmount) || !Number.isFinite(outputAmount)) {
      return [simulation.request.amount];
    }

    if (tokens.length === 2) {
      return [simulation.request.amount, simulation.quote.estimatedOutputAmount];
    }

    const bridgePrice = await this.bridgePriceFromSimulation(simulation);
    const inputUsd = simulation.quote.estimatedInputUsd;
    const bridgeAmount =
      bridgePrice > 0 ? this.formatDecimal(inputUsd / bridgePrice) : simulation.request.amount;

    return [
      simulation.request.amount,
      bridgeAmount,
      simulation.quote.estimatedOutputAmount,
    ];
  }

  private async bridgePriceFromSimulation(
    simulation: SwapSimulation,
  ): Promise<number> {
    if (simulation.market.fromAsset.dexIdentifier === this.mexBridgeAsset) {
      return simulation.market.fromAsset.priceUsd;
    }

    if (simulation.market.toAsset.dexIdentifier === this.mexBridgeAsset) {
      return simulation.market.toAsset.priceUsd;
    }

    if (simulation.market.fromAsset.identifier === 'EGLD') {
      return simulation.market.fromAsset.priceUsd;
    }

    if (simulation.market.toAsset.identifier === 'EGLD') {
      return simulation.market.toAsset.priceUsd;
    }

    try {
      const bridgeAsset = await this.fetchAsset(this.mexBridgeAsset);
      return bridgeAsset.priceUsd;
    } catch {
      return 0;
    }
  }

  private routeTokens(simulation: SwapSimulation): string[] {
    const tokens: string[] = [];
    const fromToken =
      simulation.market.fromAsset.identifier === 'EGLD'
        ? this.mexBridgeAsset
        : simulation.market.fromAsset.dexIdentifier;
    const toToken =
      simulation.market.toAsset.identifier === 'EGLD'
        ? this.mexBridgeAsset
        : simulation.market.toAsset.dexIdentifier;

    tokens.push(fromToken);

    for (const pair of simulation.route.pairs || []) {
      const current = tokens[tokens.length - 1];
      if (pair.baseId === current) {
        tokens.push(pair.quoteId);
      } else if (pair.quoteId === current) {
        tokens.push(pair.baseId);
      }
    }

    if (tokens[tokens.length - 1] !== toToken) {
      tokens.push(toToken);
    }

    return tokens;
  }

  private decimalToBaseUnits(value: string, decimals: number): string {
    const normalized = value.trim();
    if (normalized === '') {
      return '0';
    }

    const negative = normalized.startsWith('-');
    const unsigned = negative ? normalized.slice(1) : normalized;
    const [whole = '0', fraction = ''] = unsigned.split('.');
    const wholeDigits = whole.replace(/\D/g, '') || '0';
    const fractionDigits = fraction.replace(/\D/g, '');
    const paddedFraction = fractionDigits.padEnd(decimals, '0').slice(0, decimals);
    const combined = `${wholeDigits}${paddedFraction}`.replace(/^0+(?=\d)/, '') || '0';

    return negative ? `-${combined}` : combined;
  }

  private buildSwapFixedInputTemplate(parameters: {
    pairAddress: string;
    tokenIn: string;
    tokenInAmountSmallestUnit: string;
    tokenOut: string;
    minAmountOutSmallestUnit: string;
    amountReference?: ActionAmountReference;
  }) {
    return {
      kind: 'smart-contract-execute',
      chainId: this.chainId(),
      receiver: parameters.pairAddress,
      gasLimit: this.swapGasLimit(),
      function: 'swapTokensFixedInput',
      tokenTransfers: [
        {
          token: parameters.tokenIn,
          nonce: 0,
          ...(parameters.amountReference
            ? { amountSource: parameters.amountReference }
            : { amount: parameters.tokenInAmountSmallestUnit }),
        },
      ],
      arguments: [
        {
          type: 'TokenIdentifier',
          value: parameters.tokenOut,
        },
        {
          type: 'BigUInt',
          value: parameters.minAmountOutSmallestUnit,
        },
      ],
    };
  }

  private buildWrapEgldTemplate(parameters: { amountSmallestUnit: string }) {
    const wegldSwapAddress = this.wegldSwapAddress();
    if (!wegldSwapAddress) {
      return undefined;
    }

    return {
      kind: 'smart-contract-execute',
      chainId: this.chainId(),
      receiver: wegldSwapAddress,
      gasLimit: this.wegldSwapGasLimit(),
      function: 'wrapEgld',
      nativeTransferAmount: parameters.amountSmallestUnit,
      tokenTransfers: [],
      arguments: [],
    };
  }

  private buildUnwrapEgldTemplate(parameters: {
    amountSmallestUnit: string;
    amountReference?: ActionAmountReference;
  }) {
    const wegldSwapAddress = this.wegldSwapAddress();
    if (!wegldSwapAddress) {
      return undefined;
    }

    return {
      kind: 'smart-contract-execute',
      chainId: this.chainId(),
      receiver: wegldSwapAddress,
      gasLimit: this.wegldSwapGasLimit(),
      function: 'unwrapEgld',
      tokenTransfers: [
        {
          token: this.mexBridgeAsset,
          nonce: 0,
          ...(parameters.amountReference
            ? { amountSource: parameters.amountReference }
            : { amount: parameters.amountSmallestUnit }),
        },
      ],
      arguments: [],
    };
  }

  private previousActionOutputReference(
    actions: Array<Record<string, unknown>>,
    expectedToken: string,
  ): ActionAmountReference | undefined {
    const previousActionIndex = actions.length - 1;
    if (previousActionIndex < 0) {
      return undefined;
    }

    const previousAction = actions[previousActionIndex];
    const previousTokenOut =
      typeof previousAction.tokenOut === 'string' ? previousAction.tokenOut : undefined;
    if (previousTokenOut !== expectedToken) {
      return undefined;
    }

    const fallbackAmount =
      typeof previousAction.minAmountOutSmallestUnit === 'string'
        ? previousAction.minAmountOutSmallestUnit
        : typeof previousAction.outputAmountSmallestUnit === 'string'
          ? previousAction.outputAmountSmallestUnit
          : undefined;

    if (!fallbackAmount) {
      return undefined;
    }

    return {
      kind: 'previous-action-output',
      actionIndex: previousActionIndex,
      outputToken: expectedToken,
      fallbackAmount,
    };
  }

  private chainId(): string {
    return process.env.MPP_CHAIN_ID || 'D';
  }

  private wegldSwapAddress(): string | undefined {
    const configured = process.env.MPP_WEGLD_SWAP_ADDRESS?.trim();
    return configured ? configured : undefined;
  }

  private swapGasLimit(): string {
    return process.env.MPP_SWAP_EXECUTE_GAS_LIMIT || '100000000';
  }

  private wegldSwapGasLimit(): string {
    return process.env.MPP_WEGLD_SWAP_GAS_LIMIT || '10000000';
  }
}

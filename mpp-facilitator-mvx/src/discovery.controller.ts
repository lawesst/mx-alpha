import { Controller, Get, Res } from '@nestjs/common';
import type { Response as ExpressResponse } from 'express';

/**
 * MPP Discovery Endpoint
 *
 * Implements the Payment Discovery Extension (draft-payment-discovery-00).
 * Serves an OpenAPI 3.1.0 document with x-service-info and x-payment-info extensions
 * to enable AI agents and clients to discover payment capabilities.
 */
@Controller()
export class DiscoveryController {
  @Get('openapi.json')
  getOpenApiSpec(@Res() res: ExpressResponse) {
    const currency = process.env.MPP_DEFAULT_CURRENCY || 'EGLD';
    const chainId = process.env.MPP_CHAIN_ID || 'D';
    const realm = process.env.MPP_REALM || 'agentic-payments-mvx';
    const baseUrl = process.env.MPP_BASE_URL || 'http://localhost:3000';
    const paidIntelProblemHeaders = {
      'WWW-Authenticate': {
        schema: { type: 'string' },
      },
      'Retry-After': {
        schema: { type: 'string' },
        description:
          'Present when the facilitator is already tracking a payment attempt and recommends retrying with the same credential.',
      },
    };
    const paidIntelProblemSchema = {
      type: 'object',
      properties: {
        type: { type: 'string' },
        title: { type: 'string' },
        status: { type: 'integer' },
        detail: { type: 'string' },
        challengeId: { type: 'string', nullable: true },
        challenge: { type: 'string' },
        retryable: { type: 'boolean' },
        retryAfterSeconds: { type: 'integer' },
        verificationState: {
          type: 'string',
          enum: ['pending', 'verified', 'failed'],
        },
        verification: {
          type: 'object',
          nullable: true,
          properties: {
            challengeStatus: { type: 'string' },
            attempts: { type: 'integer' },
            lastCheckedAt: {
              type: 'string',
              format: 'date-time',
              nullable: true,
            },
            lastStatus: { type: 'string', nullable: true },
            lastError: { type: 'string', nullable: true },
            observedTxStatus: { type: 'string', nullable: true },
            txHash: { type: 'string', nullable: true },
          },
        },
      },
    };

    const openApiSpec = {
      openapi: '3.1.0',
      info: {
        title: 'MPP Facilitator MultiversX',
        version: '1.0.0',
        description:
          'Machine Payments Protocol facilitator for MultiversX blockchain. Supports EGLD and ESDT token payments via the MPP charge intent.',
        'x-service-info': {
          realm,
          categories: ['blockchain', 'payments', 'multiversx'],
          documentation: 'https://mpp.dev',
          supportedMethods: ['multiversx'],
          supportedIntents: ['charge', 'session', 'subscription'],
          termsOfService: `${baseUrl}/terms`,
        },
      },
      servers: [
        {
          url: baseUrl,
          description: 'MPP Facilitator Server',
        },
      ],
      paths: {
        '/protected-resource': {
          get: {
            operationId: 'getProtectedResource',
            summary: 'Access a protected resource requiring MPP payment',
            description:
              'Returns the protected resource content. Requires a valid MPP Payment credential in the Authorization header.',
            'x-payment-info': {
              intent: 'charge',
              method: 'multiversx',
              defaultCurrency: currency,
              defaultChainId: chainId,
              description: 'One-time payment to access the protected resource',
              paymentFlow: 'data-payload-tagging',
            },
            parameters: [
              {
                name: 'amount',
                in: 'query',
                description: 'The amount required for the service',
                required: true,
                schema: { type: 'string' },
              },
            ],
            responses: {
              '200': {
                description:
                  'Successful response — resource content delivered with Payment-Receipt header',
                headers: {
                  'Payment-Receipt': {
                    schema: { type: 'string' },
                    description: 'Base64-encoded payment receipt',
                  },
                },
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                    },
                  },
                },
              },
              '402': {
                description: 'Payment Required',
                headers: {
                  'WWW-Authenticate': {
                    schema: { type: 'string' },
                    description:
                      'Challenge string encoding the acceptable payment methods and amounts',
                  },
                },
                content: {
                  'application/problem+json': {
                    schema: {
                      type: 'object',
                      properties: {
                        type: { type: 'string' },
                        title: { type: 'string' },
                        status: { type: 'integer' },
                        detail: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/session-resource': {
          get: {
            operationId: 'getSessionResource',
            summary: 'Access a continuous resource requiring MPP Session',
            description:
              'Returns stream or continuous access. Requires a valid MPP Session credential in the Authorization header.',
            'x-payment-info': {
              intent: 'session',
              method: 'multiversx',
              defaultCurrency: currency,
              defaultChainId: chainId,
              duration: '1h',
              description: 'Pre-paid session to access the protected resource',
            },
            parameters: [
              {
                name: 'amount',
                in: 'query',

                required: false,
                schema: { type: 'string' },
                description: 'Override the payment amount (in smallest unit)',
              },
            ],
            responses: {
              '200': {
                description:
                  'Successful response — resource content delivered with Payment-Receipt header',
                headers: {
                  'Payment-Receipt': {
                    schema: { type: 'string' },
                    description: 'Base64-encoded payment receipt',
                  },
                },
                content: {
                  'text/plain': {
                    schema: { type: 'string' },
                  },
                },
              },
              '402': {
                description:
                  'Payment Required — returns a WWW-Authenticate challenge',
                headers: {
                  'WWW-Authenticate': {
                    schema: { type: 'string' },
                    description:
                      'Payment challenge in the Payment authentication scheme',
                  },
                  'Cache-Control': {
                    schema: { type: 'string', example: 'no-store' },
                  },
                },
                content: {
                  'application/problem+json': {
                    schema: {
                      type: 'object',
                      properties: {
                        type: { type: 'string' },
                        title: { type: 'string' },
                        status: { type: 'integer', example: 402 },
                        detail: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
            security: [{ PaymentAuth: [] }],
          },
        },
        '/subscription-resource': {
          get: {
            operationId: 'getSubscriptionResource',
            summary: 'Access a premium resource requiring MPP Subscription',
            description:
              'Returns premium content access. Requires a valid MPP Subscription credential in the Authorization header.',
            'x-payment-info': {
              intent: 'subscription',
              method: 'multiversx',
              defaultCurrency: currency,
              defaultChainId: chainId,
              interval: 'monthly',
              description: 'Recurring subscription to access premium features',
            },
            parameters: [
              {
                name: 'amount',
                in: 'query',
                required: false,
                schema: { type: 'string' },
                description: 'Override the payment amount (in smallest unit)',
              },
            ],
            responses: {
              '200': {
                description:
                  'Successful response — resource content delivered with Payment-Receipt header',
                headers: {
                  'Payment-Receipt': {
                    schema: { type: 'string' },
                    description: 'Base64-encoded payment receipt',
                  },
                },
                content: {
                  'text/plain': {
                    schema: { type: 'string' },
                  },
                },
              },
              '402': {
                description:
                  'Payment Required — returns a WWW-Authenticate challenge',
                headers: {
                  'WWW-Authenticate': {
                    schema: { type: 'string' },
                    description:
                      'Payment challenge in the Payment authentication scheme',
                  },
                  'Cache-Control': {
                    schema: { type: 'string', example: 'no-store' },
                  },
                },
                content: {
                  'application/problem+json': {
                    schema: {
                      type: 'object',
                      properties: {
                        type: { type: 'string' },
                        title: { type: 'string' },
                        status: { type: 'integer', example: 402 },
                        detail: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
            security: [{ PaymentAuth: [] }],
          },
        },
        '/submit_relayed_v3': {
          post: {
            operationId: 'submitRelayedV3',
            summary:
              'Submit a Relayed V3 transaction for fee-payer functionality',
            description:
              'Accepts a pre-signed transaction, adds the relayer signature, and broadcasts to the MultiversX network.',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: [
                      'nonce',
                      'value',
                      'receiver',
                      'sender',
                      'relayer',
                      'gasPrice',
                      'gasLimit',
                      'chainID',
                      'version',
                      'signature',
                    ],
                    properties: {
                      nonce: { type: 'integer' },
                      value: { type: 'string' },
                      receiver: {
                        type: 'string',
                        description: 'Bech32 receiver address',
                      },
                      sender: {
                        type: 'string',
                        description: 'Bech32 sender address',
                      },
                      relayer: {
                        type: 'string',
                        description: 'Bech32 relayer address',
                      },
                      gasPrice: { type: 'integer' },
                      gasLimit: { type: 'integer' },
                      data: {
                        type: 'string',
                        description: 'Transaction data (optional)',
                      },
                      chainID: { type: 'string' },
                      version: { type: 'integer', minimum: 2 },
                      options: { type: 'integer' },
                      signature: {
                        type: 'string',
                        description: 'Hex-encoded sender signature',
                      },
                    },
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Transaction broadcast successfully',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        success: { type: 'boolean' },
                        txHash: { type: 'string' },
                      },
                    },
                  },
                },
              },
              '400': {
                description:
                  'Bad request — invalid payload or broadcast failure',
              },
              '429': {
                description: 'Rate limit exceeded',
              },
            },
          },
        },
        '/relayer_address': {
          get: {
            operationId: 'getRelayerAddress',
            summary: 'Get the relayer address for Relayed V3 transactions',
            responses: {
              '200': {
                description: 'Relayer address',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        address: {
                          type: 'string',
                          description: 'Bech32 relayer address',
                        },
                      },
                    },
                  },
                },
              },
              '404': {
                description: 'Relayer not configured',
              },
            },
          },
        },
        '/challenges': {
          post: {
            operationId: 'createChallenge',
            summary: 'Register a challenge for verification',
            description:
              'Creates a settlement record so the verifier can later validate a transaction against it.',
            'x-payment-info': {
              intent: 'charge',
              method: 'multiversx',
            },
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['id', 'receiver', 'amount'],
                    properties: {
                      id: { type: 'string', description: 'Challenge ID' },
                      receiver: {
                        type: 'string',
                        description: 'Expected receiver bech32 address',
                      },
                      amount: {
                        type: 'string',
                        description: 'Expected amount in smallest unit',
                      },
                      currency: {
                        type: 'string',
                        description: 'Token identifier (default: EGLD)',
                      },
                      chainId: {
                        type: 'string',
                        description: 'Chain ID (default: D)',
                      },
                      expiresAt: {
                        type: 'string',
                        format: 'date-time',
                        description: 'Challenge expiry (ISO 8601)',
                      },
                    },
                  },
                },
              },
            },
            responses: {
              '201': {
                description: 'Challenge registered',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        success: { type: 'boolean' },
                        challengeId: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/challenges/{id}': {
          get: {
            operationId: 'getChallenge',
            summary: 'Inspect a stored challenge',
            description:
              'Returns the settlement record for a challenge, including the latest verification diagnostics and observed transaction status.',
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: { type: 'string' },
                description: 'Challenge ID',
              },
            ],
            responses: {
              '200': {
                description: 'Stored challenge record',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        status: { type: 'string' },
                        txHash: { type: 'string', nullable: true },
                        payer: { type: 'string', nullable: true },
                        receiver: { type: 'string', nullable: true },
                        amount: { type: 'string', nullable: true },
                        currency: { type: 'string', nullable: true },
                        verificationAttempts: { type: 'integer' },
                        lastVerificationAt: {
                          type: 'string',
                          format: 'date-time',
                          nullable: true,
                        },
                        lastVerificationStatus: {
                          type: 'string',
                          nullable: true,
                        },
                        lastVerificationError: {
                          type: 'string',
                          nullable: true,
                        },
                        lastObservedTxStatus: {
                          type: 'string',
                          nullable: true,
                        },
                        lastVerificationTxHash: {
                          type: 'string',
                          nullable: true,
                        },
                      },
                    },
                  },
                },
              },
              '404': {
                description: 'Challenge not found',
              },
            },
          },
        },
        '/openapi.json': {
          get: {
            operationId: 'getOpenApiSpec',
            summary: 'MPP Service Discovery',
            description:
              'Returns the OpenAPI specification with x-payment-info and x-service-info extensions per the MPP Discovery spec.',
            responses: {
              '200': {
                description: 'OpenAPI 3.1.0 specification',
                content: {
                  'application/json': {
                    schema: { type: 'object' },
                  },
                },
              },
            },
          },
        },
        '/intel/token-risk': {
          get: {
            operationId: 'getTokenRisk',
            summary: 'Get a paid token risk report',
            description:
              'Returns a structured token risk report after a one-time MultiversX payment.',
            'x-payment-info': {
              intent: 'charge',
              method: 'multiversx',
              defaultCurrency: currency,
              defaultChainId: chainId,
              description: 'One-time payment for token intelligence',
              paymentFlow: 'data-payload-tagging',
            },
            parameters: [
              {
                name: 'token',
                in: 'query',
                required: true,
                schema: { type: 'string' },
                description: 'MultiversX token identifier',
              },
            ],
            responses: {
              '200': {
                description: 'Structured token risk report',
                headers: {
                  'Payment-Receipt': {
                    schema: { type: 'string' },
                    description: 'Base64-encoded payment receipt',
                  },
                },
                content: {
                  'application/json': {
                    schema: { type: 'object' },
                  },
                },
              },
              '402': {
                description: 'Payment Required',
                headers: paidIntelProblemHeaders,
                content: {
                  'application/problem+json': {
                    schema: paidIntelProblemSchema,
                  },
                },
              },
            },
          },
        },
        '/intel/wallet-profile': {
          get: {
            operationId: 'getWalletProfile',
            summary: 'Get a paid wallet profile report',
            description:
              'Returns a structured wallet profile after a one-time MultiversX payment.',
            'x-payment-info': {
              intent: 'charge',
              method: 'multiversx',
              defaultCurrency: currency,
              defaultChainId: chainId,
              description: 'One-time payment for wallet intelligence',
              paymentFlow: 'data-payload-tagging',
            },
            parameters: [
              {
                name: 'address',
                in: 'query',
                required: true,
                schema: { type: 'string' },
                description: 'MultiversX bech32 wallet address',
              },
            ],
            responses: {
              '200': {
                description: 'Structured wallet profile',
                headers: {
                  'Payment-Receipt': {
                    schema: { type: 'string' },
                    description: 'Base64-encoded payment receipt',
                  },
                },
                content: {
                  'application/json': {
                    schema: { type: 'object' },
                  },
                },
              },
              '402': {
                description: 'Payment Required',
                headers: paidIntelProblemHeaders,
                content: {
                  'application/problem+json': {
                    schema: paidIntelProblemSchema,
                  },
                },
              },
            },
          },
        },
        '/intel/swap-sim': {
          get: {
            operationId: 'getSwapSimulation',
            summary: 'Get a paid swap simulation',
            description:
              'Returns an estimated swap route and execution summary after a one-time MultiversX payment.',
            'x-payment-info': {
              intent: 'charge',
              method: 'multiversx',
              defaultCurrency: currency,
              defaultChainId: chainId,
              description: 'One-time payment for swap route simulation',
              paymentFlow: 'data-payload-tagging',
            },
            parameters: [
              {
                name: 'from',
                in: 'query',
                required: true,
                schema: { type: 'string' },
                description: 'Input asset identifier, for example EGLD or an ESDT ticker',
              },
              {
                name: 'to',
                in: 'query',
                required: true,
                schema: { type: 'string' },
                description: 'Output asset identifier, for example EGLD or an ESDT ticker',
              },
              {
                name: 'amount',
                in: 'query',
                required: true,
                schema: { type: 'string' },
                description: 'Human-readable input amount to simulate',
              },
            ],
            responses: {
              '200': {
                description: 'Structured swap simulation response',
                headers: {
                  'Payment-Receipt': {
                    schema: { type: 'string' },
                    description: 'Base64-encoded payment receipt',
                  },
                },
                content: {
                  'application/json': {
                    schema: { type: 'object' },
                  },
                },
              },
              '402': {
                description: 'Payment Required',
                headers: paidIntelProblemHeaders,
                content: {
                  'application/problem+json': {
                    schema: paidIntelProblemSchema,
                  },
                },
              },
            },
          },
        },
        '/intel/swap-plan': {
          get: {
            operationId: 'getSwapExecutionPlan',
            summary: 'Get a paid swap execution plan',
            description:
              'Returns an agent-friendly execution plan with route hops, pair addresses, min-output targets, and signing hints after a one-time MultiversX payment.',
            'x-payment-info': {
              intent: 'charge',
              method: 'multiversx',
              defaultCurrency: currency,
              defaultChainId: chainId,
              description: 'One-time payment for swap execution planning',
              paymentFlow: 'data-payload-tagging',
            },
            parameters: [
              {
                name: 'from',
                in: 'query',
                required: true,
                schema: { type: 'string' },
                description: 'Input asset identifier, for example EGLD or an ESDT ticker',
              },
              {
                name: 'to',
                in: 'query',
                required: true,
                schema: { type: 'string' },
                description: 'Output asset identifier, for example EGLD or an ESDT ticker',
              },
              {
                name: 'amount',
                in: 'query',
                required: true,
                schema: { type: 'string' },
                description: 'Human-readable input amount to plan for',
              },
            ],
            responses: {
              '200': {
                description: 'Structured swap execution plan response',
                headers: {
                  'Payment-Receipt': {
                    schema: { type: 'string' },
                    description: 'Base64-encoded payment receipt',
                  },
                },
                content: {
                  'application/json': {
                    schema: { type: 'object' },
                  },
                },
              },
              '402': {
                description: 'Payment Required',
                headers: paidIntelProblemHeaders,
                content: {
                  'application/problem+json': {
                    schema: paidIntelProblemSchema,
                  },
                },
              },
            },
          },
        },
        '/audit-reports': {
          get: {
            operationId: 'listAuditReports',
            summary: 'List ingested paid intel audit reports',
            description:
              'Returns recent ingested paid intel audit reports with optional endpoint and status filters.',
            parameters: [
              {
                name: 'endpoint',
                in: 'query',
                required: false,
                schema: { type: 'string' },
                description: 'Filter reports by endpoint name',
              },
              {
                name: 'status',
                in: 'query',
                required: false,
                schema: { type: 'string', enum: ['success', 'error'] },
                description: 'Filter reports by execution status',
              },
              {
                name: 'paymentTxHash',
                in: 'query',
                required: false,
                schema: { type: 'string' },
                description: 'Filter reports by payment transaction hash',
              },
              {
                name: 'limit',
                in: 'query',
                required: false,
                schema: { type: 'integer', minimum: 1, maximum: 100 },
                description: 'Maximum number of reports to return',
              },
            ],
            responses: {
              '200': {
                description: 'Stored paid intel audit report list',
                content: {
                  'application/json': {
                    schema: { type: 'object' },
                  },
                },
              },
            },
          },
          post: {
            operationId: 'ingestAuditReport',
            summary: 'Ingest a paid intel audit report',
            description:
              'Stores a JSON audit report emitted by the mx-alpha paid intel client for later review and summarization.',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
            responses: {
              '201': {
                description: 'Stored audit report summary',
                content: {
                  'application/json': {
                    schema: { type: 'object' },
                  },
                },
              },
              '400': {
                description: 'Invalid audit report payload',
              },
            },
          },
        },
        '/audit-reports/summary': {
          get: {
            operationId: 'getAuditReportSummary',
            summary: 'Summarize ingested paid intel audit reports',
            description:
              'Returns aggregate counts, latest report pointers, and error kind breakdowns for ingested paid intel audit reports.',
            parameters: [
              {
                name: 'endpoint',
                in: 'query',
                required: false,
                schema: { type: 'string' },
                description: 'Optionally scope the summary to a single endpoint',
              },
              {
                name: 'paymentTxHash',
                in: 'query',
                required: false,
                schema: { type: 'string' },
                description:
                  'Optionally scope the summary to a single payment transaction hash',
              },
            ],
            responses: {
              '200': {
                description: 'Stored paid intel audit report summary',
                content: {
                  'application/json': {
                    schema: { type: 'object' },
                  },
                },
              },
            },
          },
        },
        '/audit-reports/by-payment/{paymentTxHash}': {
          get: {
            operationId: 'getAuditReportByPaymentTxHash',
            summary: 'Fetch the latest audit report for a payment transaction hash',
            description:
              'Returns the latest stored audit report that references a given payment transaction hash.',
            parameters: [
              {
                name: 'paymentTxHash',
                in: 'path',
                required: true,
                schema: { type: 'string' },
                description: 'Payment transaction hash to look up',
              },
            ],
            responses: {
              '200': {
                description: 'Stored audit report detail',
                content: {
                  'application/json': {
                    schema: { type: 'object' },
                  },
                },
              },
              '404': {
                description: 'Audit report not found for the payment transaction hash',
              },
            },
          },
        },
        '/audit-reports/{id}': {
          get: {
            operationId: 'getAuditReport',
            summary: 'Fetch one ingested paid intel audit report',
            description:
              'Returns the stored audit report payload and metadata for a specific report id.',
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: { type: 'string' },
                description: 'Stored audit report identifier',
              },
            ],
            responses: {
              '200': {
                description: 'Stored audit report detail',
                content: {
                  'application/json': {
                    schema: { type: 'object' },
                  },
                },
              },
              '404': {
                description: 'Audit report not found',
              },
            },
          },
        },
      },
      components: {
        securitySchemes: {
          PaymentAuth: {
            type: 'http',
            scheme: 'Payment',
            description:
              'MPP Payment authentication scheme (RFC draft-httpauth-payment-00)',
          },
        },
      },
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'max-age=300');
    res.status(200).json(openApiSpec);
  }
}

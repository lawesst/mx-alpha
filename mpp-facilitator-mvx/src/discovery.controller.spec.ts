/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { DiscoveryController } from './discovery.controller';
import { Response } from 'express';

describe('DiscoveryController', () => {
  let controller: DiscoveryController;

  beforeEach(() => {
    // Set required env vars
    process.env.MPP_DEFAULT_CURRENCY = 'EGLD';
    process.env.MPP_CHAIN_ID = 'D';
    process.env.MPP_REALM = 'test-realm';
    process.env.MPP_BASE_URL = 'http://localhost:3000';

    controller = new DiscoveryController();
  });

  afterEach(() => {
    delete process.env.MPP_DEFAULT_CURRENCY;
    delete process.env.MPP_CHAIN_ID;
    delete process.env.MPP_REALM;
    delete process.env.MPP_BASE_URL;
  });

  it('should return valid OpenAPI 3.1.0 document', () => {
    let responseBody: Record<string, any> = {};
    const responseHeaders: Record<string, string> = {};
    let responseStatus: number = 0;

    const mockRes = {
      setHeader: (key: string, val: string) => {
        responseHeaders[key] = val;
      },
      status: (code: number) => ({
        json: (body: any) => {
          responseStatus = code;
          responseBody = body;
        },
      }),
    } as unknown as Response;

    controller.getOpenApiSpec(mockRes);

    expect(responseStatus).toBe(200);
    expect(responseHeaders['Content-Type']).toBe('application/json');
    expect(responseHeaders['Cache-Control']).toBe('max-age=300');
    expect(responseBody.openapi).toBe('3.1.0');
    expect(responseBody.info.title).toBe('MPP Facilitator MultiversX');
  });

  it('should include x-service-info in info section', () => {
    let responseBody: Record<string, any> = {};
    const mockRes = {
      setHeader: () => {},
      status: () => ({
        json: (body: any) => {
          responseBody = body;
        },
      }),
    } as unknown as Response;

    controller.getOpenApiSpec(mockRes);

    const serviceInfo = responseBody.info['x-service-info'];
    expect(serviceInfo).toBeDefined();
    expect(serviceInfo.realm).toBe('test-realm');
    expect(serviceInfo.categories).toContain('payments');
    expect(serviceInfo.supportedMethods).toContain('multiversx');
    expect(serviceInfo.supportedIntents).toContain('charge');
  });

  it('should include x-payment-info on protected-resource operation', () => {
    let responseBody: Record<string, any> = {};
    const mockRes = {
      setHeader: () => {},
      status: () => ({
        json: (body: any) => {
          responseBody = body;
        },
      }),
    } as unknown as Response;

    controller.getOpenApiSpec(mockRes);

    const paymentInfo =
      responseBody.paths['/protected-resource'].get['x-payment-info'];
    expect(paymentInfo).toBeDefined();
    expect(paymentInfo.intent).toBe('charge');
    expect(paymentInfo.method).toBe('multiversx');
    expect(paymentInfo.defaultCurrency).toBe('EGLD');
  });

  it('should declare 402 response with WWW-Authenticate header', () => {
    let responseBody: Record<string, any> = {};
    const mockRes = {
      setHeader: () => {},
      status: () => ({
        json: (body: any) => {
          responseBody = body;
        },
      }),
    } as unknown as Response;

    controller.getOpenApiSpec(mockRes);

    const responses = responseBody.paths['/protected-resource'].get.responses;
    expect(responses['402']).toBeDefined();
    expect(responses['402'].headers['WWW-Authenticate']).toBeDefined();
    expect(responses['402'].content['application/problem+json']).toBeDefined();
  });

  it('should include x-payment-info on swap-sim operation', () => {
    let responseBody: Record<string, any> = {};
    const mockRes = {
      setHeader: () => {},
      status: () => ({
        json: (body: any) => {
          responseBody = body;
        },
      }),
    } as unknown as Response;

    controller.getOpenApiSpec(mockRes);

    const paymentInfo = responseBody.paths['/intel/swap-sim'].get['x-payment-info'];
    expect(paymentInfo).toBeDefined();
    expect(paymentInfo.intent).toBe('charge');
    expect(paymentInfo.method).toBe('multiversx');
    expect(paymentInfo.defaultCurrency).toBe('EGLD');
  });

  it('should include x-payment-info on swap-plan operation', () => {
    let responseBody: Record<string, any> = {};
    const mockRes = {
      setHeader: () => {},
      status: () => ({
        json: (body: any) => {
          responseBody = body;
        },
      }),
    } as unknown as Response;

    controller.getOpenApiSpec(mockRes);

    const paymentInfo = responseBody.paths['/intel/swap-plan'].get['x-payment-info'];
    expect(paymentInfo).toBeDefined();
    expect(paymentInfo.intent).toBe('charge');
    expect(paymentInfo.method).toBe('multiversx');
    expect(paymentInfo.defaultCurrency).toBe('EGLD');
  });

  it('should include Payment security scheme', () => {
    let responseBody: Record<string, any> = {};
    const mockRes = {
      setHeader: () => {},
      status: () => ({
        json: (body: any) => {
          responseBody = body;
        },
      }),
    } as unknown as Response;

    controller.getOpenApiSpec(mockRes);

    const paymentAuth = responseBody.components.securitySchemes.PaymentAuth;
    expect(paymentAuth).toBeDefined();
    expect(paymentAuth.scheme).toBe('Payment');
  });

  it('should include all API paths', () => {
    let responseBody: Record<string, any> = {};
    const mockRes = {
      setHeader: () => {},
      status: () => ({
        json: (body: any) => {
          responseBody = body;
        },
      }),
    } as unknown as Response;

    controller.getOpenApiSpec(mockRes);

    expect(responseBody.paths['/protected-resource']).toBeDefined();
    expect(responseBody.paths['/session-resource']).toBeDefined();
    expect(responseBody.paths['/submit_relayed_v3']).toBeDefined();
    expect(responseBody.paths['/relayer_address']).toBeDefined();
    expect(responseBody.paths['/challenges']).toBeDefined();
    expect(responseBody.paths['/openapi.json']).toBeDefined();
    expect(responseBody.paths['/intel/token-risk']).toBeDefined();
    expect(responseBody.paths['/intel/wallet-profile']).toBeDefined();
    expect(responseBody.paths['/intel/swap-sim']).toBeDefined();
    expect(responseBody.paths['/intel/swap-plan']).toBeDefined();
    expect(responseBody.paths['/audit-reports']).toBeDefined();
    expect(responseBody.paths['/audit-reports/summary']).toBeDefined();
    expect(responseBody.paths['/audit-reports/{id}']).toBeDefined();
  });
});

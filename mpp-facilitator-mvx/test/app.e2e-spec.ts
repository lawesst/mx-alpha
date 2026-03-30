import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/protected-resource (GET) without Authorization should return 402', () => {
    return request(app.getHttpServer())
      .get('/protected-resource')
      .expect(402)
      .expect((res) => {
        if (!res.headers['www-authenticate']) {
          throw new Error('Missing WWW-Authenticate header');
        }
        if (!res.headers['www-authenticate'].startsWith('MPP')) {
          throw new Error('Incorrect WWW-Authenticate header content');
        }
      });
  });

  it('/submit_relayed_v3 (POST) without configured relayer should fail', () => {
    return request(app.getHttpServer())
      .post('/submit_relayed_v3')
      .send({
        nonce: 1,
        value: '0',
        receiver:
          'erd1qqqqqqqqqqqqqqqpqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqplllst77y4l',
        sender:
          'erd1spyavw0956vq68xj8y4tenjpq2wd5a9p2c6j8gsz7ztycsv371swpfehc0',
        relayer:
          'erd1spyavw0956vq68xj8y4tenjpq2wd5a9p2c6j8gsz7ztycsv371swpfehc0',
        gasPrice: 1000000000,
        gasLimit: 50000,
        chainID: 'D',
        version: 2,
        signature: 'hex_signature_here',
      })
      .expect(400); // Because we don't have the relayer loaded with an identical address
  });
});

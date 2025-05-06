/*!
 * Copyright (c) 2024-2025 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import {httpClient} from '@digitalbazaar/http-client';
import {httpsAgent} from '@bedrock/https-agent';

import {mockData} from './mock.data.js';

describe('http API', () => {
  describe('verify a VCB', () => {
    const target = '/features/verify-vcb';
    let url;
    before(async () => {
      url = `${bedrock.config.server.baseUri}${target}`;
    });

    it('verifies VCB "text" transformed to an enveloped VC', async () => {
      let err;
      let result;
      try {
        const response = await httpClient.post(url, {
          agent: httpsAgent,
          json: {text: mockData.vcbText}
        });
        result = response.data;
      } catch(e) {
        err = e;
      }
      assertNoError(err);
      should.exist(result);
      result.should.include.keys(['credential', 'verified', 'expired']);
      result.verified.should.equal(true);
    });

    it('verifies VCB "barcode" transformed to an enveloped VC', async () => {
      let err;
      let result;
      try {
        const response = await httpClient.post(url, {
          agent: httpsAgent,
          json: {
            barcode: {
              data: mockData.vcbText,
              format: 'qr_code'
            }
          }
        });
        result = response.data;
      } catch(e) {
        err = e;
      }
      assertNoError(err);
      should.exist(result);
      result.should.include.keys(['credential', 'verified', 'expired']);
      result.verified.should.equal(true);
    });
  });

  describe('(legacy) verify a VCB', () => {
    const target = '/features/legacy-verify-vcb';
    let url;
    before(async () => {
      url = `${bedrock.config.server.baseUri}${target}`;
    });

    it('verifies VCB "text" locally converted from CBOR-LD', async () => {
      let err;
      let result;
      try {
        const response = await httpClient.post(url, {
          agent: httpsAgent,
          json: {text: mockData.vcbText}
        });
        result = response.data;
      } catch(e) {
        err = e;
      }
      assertNoError(err);
      should.exist(result);
      result.should.include.keys(['credential', 'verified', 'expired']);
      result.verified.should.equal(true);
    });
  });
});

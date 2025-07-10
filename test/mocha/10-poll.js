/*!
 * Copyright (c) 2024-2025 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import {poll, pollers, zcapClient} from '@bedrock/notify';
import {httpClient} from '@digitalbazaar/http-client';
import {httpsAgent} from '@bedrock/https-agent';

import {mockData} from './mock.data.js';

describe('poll', () => {
  let target;
  let capability;
  let pollExchange;
  before(async () => {
    // mock capability for communicating w/mock VC-API exchange server
    const {baseUri} = bedrock.config.server;
    target = `${baseUri}/workflows/1/exchanges`;
    capability = `urn:zcap:root:${encodeURIComponent(target)}`;
    pollExchange = pollers.createExchangePoller({
      capability,
      filterExchange({exchange, previousPollResult}) {
        if(previousPollResult?.value?.exchange?.state === exchange.state) {
          // nothing new to update
          return;
        }
        // return only the information that should be accessible to the client
        return {
          exchange: {
            state: exchange.state,
            result: exchange.variables.results?.verify?.verifiablePresentation
          }
        };
      }
    });
  });

  it('polls an exchange', async () => {
    // create an exchange
    let exchangeId;
    {
      const response = await zcapClient.write({
        json: {
          // quick 5 minute TTL
          ttl: 5 * 60,
          variables: {}
        },
        capability
      });
      exchangeId = response.headers.get('location');
    }

    // poll the exchange
    {
      const result = await poll({id: exchangeId, poller: pollExchange});
      result.value.should.deep.equal({
        exchange: {state: 'pending', result: undefined}
      });
    }

    // poll the exchange *again* (using a fresh value)
    {
      const result = await poll({
        id: exchangeId, poller: pollExchange, useCache: false
      });
      result.value.should.deep.equal({
        exchange: {state: 'pending', result: undefined}
      });
    }

    // use exchange
    {
      let error;
      try {
        const verifiablePresentation = {
          '@context': ['https://www.w3.org/ns/credentials/v2'],
          type: ['VerifiablePresentation'],
          verifiableCredential: [mockData.envelopeVerifiableCredential]
        };
        await httpClient.post(exchangeId, {
          agent: httpsAgent,
          json: {verifiablePresentation}
        });
      } catch(e) {
        error = e;
      }
      assertNoError(error);
    }

    // poll the exchange (using the cached value)
    {
      const result = await poll({id: exchangeId, poller: pollExchange});
      result.value.should.deep.equal({
        exchange: {state: 'pending', result: undefined}
      });
    }

    // poll the exchange (using a fresh value)
    {
      const result = await poll({
        id: exchangeId, poller: pollExchange, useCache: false
      });
      result.value.exchange.state.should.equal('complete');
      const expectedResult = {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['VerifiablePresentation'],
        verifiableCredential: [mockData.verifiableCredential]
      };
      result.value.exchange.result.should.deep.equal(expectedResult);
    }
  });
});

/*!
 * Copyright (c) 2024-2025 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import {watchers, watches, zcapClient} from '@bedrock/notify';
import {httpClient} from '@digitalbazaar/http-client';
import {httpsAgent} from '@bedrock/https-agent';

import {mockData} from './mock.data.js';

describe('watch API', () => {
  let target;
  let capability;
  before(async () => {
    // mock capability for communicating w/mock VC-API exchange server
    const {baseUri} = bedrock.config.server;
    target = `${baseUri}/workflows/1/exchanges`;
    capability = `urn:zcap:root:${encodeURIComponent(target)}`;

    // set fast lock expiry and reschedule times
    watchers._setLockExpiresTimeHook(() => 0);
    watchers._setRescheduleTimeHook(() => 50);
  });

  it('watches an exchange', async () => {
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

    // start watching the exchange
    await watchers.watch({
      id: exchangeId,
      watcher: 'watchExchange',
      value: {state: 'pending'},
      // five minute TTL
      ttl: 5 * 60
    });

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

    // wait for watch update
    await new Promise(r => setTimeout(r, 200));

    // get the watch record
    const record = await watches.get({id: exchangeId});

    // remove the watch record to stop polling
    await watches.remove({id: exchangeId});

    // check watch record
    should.exist(record.watch);
    const {watch} = record;
    watch.mutable.should.equal(false);
    should.exist(watch.value);
    const {value} = watch;
    value.state.should.equal('complete');

    const expectedResult = {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: ['VerifiablePresentation'],
      verifiableCredential: [mockData.verifiableCredential]
    };
    value.result.should.deep.equal(expectedResult);
  });
});

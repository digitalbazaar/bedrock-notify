/*!
 * Copyright (c) 2024-2025 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import {zcapClient as _zcapClient} from './zcapClient.js';
import assert from 'assert-plus';

const {util: {BedrockError}} = bedrock;

export function createExchangeWatcher({
  capability, filterExchange, zcapClient = _zcapClient
} = {}) {
  if(typeof capability !== 'string') {
    assert.object(capability, 'options.capability');
  }
  assert.object(zcapClient, 'options.zcapClient');
  assert.func(filterExchange, 'options.filterExchange');

  return async function watchExchange({record} = {}) {
    try {
      const {watch} = record;
      const {id: exchangeId} = watch;
      if(watch.value?.state === 'complete' ||
        watch.value?.state === 'invalid') {
        // exchange complete/invalid, do not continue polling
        return {value: undefined};
      }
      const response = await zcapClient.read({url: exchangeId, capability});
      const {data: {exchange}} = response;
      // `filterExchange` can opt to return `undefined` if the exchange has
      // not sufficiently changed in any way (e.g., state has remained the
      // same as before and `value` was initialized to an exchange with a
      // pending state, etc.)
      const value = await filterExchange({record, exchange});
      return {value};
    } catch(cause) {
      throw new BedrockError(
        'Could not fetch exchange state.', {
          name: 'OperationError',
          details: {httpStatusCode: 500, public: true},
          cause
        });
    }
  };
}

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
      const response = await zcapClient.read({url: exchangeId, capability});
      const {data: {exchange}} = response;
      // consider exchange state mutable while it is not complete/invalid
      const mutable = !(exchange.state === 'complete' ||
        exchange.state === 'invalid');
      // `filterExchange` can opt to return `undefined` if the exchange has
      // not sufficiently changed in any way (e.g., state has remained the
      // same as before and `value` was initialized to an exchange with a
      // pending state, etc.)
      const filtered = await filterExchange({record, exchange});
      if(!filtered) {
        return {value: undefined, mutable: record.watch.mutable};
      }
      const {exchange: value} = filtered;
      return {value, mutable};
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

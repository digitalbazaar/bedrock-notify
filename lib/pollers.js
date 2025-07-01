/*!
 * Copyright (c) 2024-2025 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import {zcapClient as _zcapClient} from './zcapClient.js';
import assert from 'assert-plus';

const {util: {BedrockError}} = bedrock;

// creates a function that will poll an exchange for updated state when called
// usage:
/*
const fn = createExchangePoller({
  capability,
  filterExchange({exchange, previousPollResult}) {
    if(previousPollResult.value.state === exchange.state) {
      // nothing new to update
      return undefined;
    }
    // return only the information that should be accessible to the client
    return {
      exchange: {
        state: exchange.state,
        result: exchange.variables.results.myStepName.verifiablePresentation
      }
    };
  }

*/
export function createExchangePoller({
  capability, filterExchange, zcapClient = _zcapClient
} = {}) {
  if(typeof capability !== 'string') {
    assert.object(capability, 'options.capability');
  }
  assert.object(zcapClient, 'options.zcapClient');
  assert.func(filterExchange, 'options.filterExchange');

  return async function pollExchange({id, currentResult} = {}) {
    try {
      const response = await zcapClient.read({url: id, capability});
      const {data: {exchange}} = response;
      // consider exchange state mutable while it is not complete/invalid
      const mutable = !(exchange.state === 'complete' ||
        exchange.state === 'invalid');
      // `filterExchange` can opt to return `undefined` if the exchange has
      // not sufficiently changed in any way (e.g., state has remained the
      // same as before and `value` was initialized to an exchange with a
      // pending state, etc.)
      const filtered = await filterExchange({
        exchange, previousPollResult: currentResult
      });
      if(!filtered) {
        // no change, keep current result
        return {
          value: currentResult?.value,
          mutable: !!currentResult?.mutable
        };
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

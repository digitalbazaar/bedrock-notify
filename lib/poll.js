/*!
 * Copyright (c) 2024-2025 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import assert from 'assert-plus';
import {LRUCache as LRU} from 'lru-cache';
import {LruCache} from '@digitalbazaar/lru-memoize';

// fifteen minute max TTL for poll results
const MAX_TTL = 1000 * 60 * 15;

let POLL_CACHE;
let POLL_RESULT_CACHE;

// FIXME: add `p-queue` to restrict total concurrent polling operations to
// POLL_CACHE size
// let POLL_QUEUE;

bedrock.events.on('bedrock.init', async () => {
  _createPollCache();
  _createPollResultCache();
});

// FIXME: determine if initial `value` is still needed

/**
 * Starts or reuses an existing concurrent polling operation associated with
 * a watched resource. The watched resource is identified by `id`; if any
 * concurrent polling operation is presently polling for updates to the same
 * resource, its result will be used and `poller` will be ignored.
 *
 * @param {object} options - Options to use.
 * @param {string} options.id - The ID for the watched resource.
 * @param {Function} options.poller - The polling function to use to poll the
 *   resource.
 * @param {*} [options.value=null] - An optional initial value to set for the
 *   watched resource.
 * @param {Date} [options.expires] - An optional expiration date for the
 *   poll result; defaults to 15 minutes from creation time if not provided.
 *
 * @returns {Promise<object>} An object with the record.
 */
export async function poll({id, poller, value = null, expires} = {}) {
  assert.string(id, 'options.id');
  assert.function(poller, 'options.poller');
  assert.optionalDate(expires, 'options.expires');

  // FIXME: determine if useCache/fresh should be an option
  const result = POLL_RESULT_CACHE.get(id);
  if(result !== undefined) {
    return result;
  }

  // use `disposeOnSettle` to clear poll operation from cache once completed
  const options = {disposeOnSettle: true};
  const fn = () => _getUncachedPollResult({id, poller, value, expires});
  return POLL_CACHE.memoize({key: id, fn, options});
}

// exposed for testing purposes only
export function _resetPollCache({ttl} = {}) {
  _createPollCache({ttl});
}

// exposed for testing purposes only
export function _resetPollResultCache({ttl} = {}) {
  _createPollResultCache({ttl});
}

function _createPollCache({ttl} = {}) {
  const cfg = bedrock.config.notify;
  const options = {...cfg.caches.poll};
  if(ttl !== undefined) {
    options.ttl = ttl;
  }
  POLL_CACHE = new LRU(options);
}

function _createPollResultCache({ttl} = {}) {
  const cfg = bedrock.config.notify;
  const options = {...cfg.caches.pollResult};
  if(ttl !== undefined) {
    options.ttl = ttl;
  }
  POLL_RESULT_CACHE = new LruCache(options);
}

async function _getUncachedPollResult({id, poller}) {
  let sequence = 0;
  const currentResult = POLL_RESULT_CACHE.get(id);
  if(currentResult !== undefined) {
    if(!currentResult.mutable) {
      // result is not mutable; update TTL to max and return
      POLL_RESULT_CACHE.set(id, currentResult, {ttl: MAX_TTL});
      return currentResult;
    }
    // get latest sequence
    sequence = currentResult.sequence;
  }

  // FIXME: schedule poller on p-queue to ensure max concurrency is managed

  // FIXME: try/catch or should poller do it?
  // get poll value
  const {mutable, value} = await poller();

  // create poll result
  const result = {id, sequence: sequence + 1, mutable, value};

  // update result cache; use max TTL if result is immutable
  let options;
  if(!mutable) {
    options = {ttl: MAX_TTL};
  }
  POLL_RESULT_CACHE.set(id, result, options);

  return result;
}

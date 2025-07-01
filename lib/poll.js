/*!
 * Copyright (c) 2024-2025 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import assert from 'assert-plus';
import {LRUCache as LRU} from 'lru-cache';
import {LruCache} from '@digitalbazaar/lru-memoize';

const {util: {BedrockError}} = bedrock;

// fifteen minute max TTL for poll results
const MAX_TTL = 1000 * 60 * 15;

/* Note on caching: Two caches are used for managing polling. One for ensuring
that a given process only has one inflight concurrent request for a fresh
result and another for the results. If only the first cache were used, then
results would not last longer than the runtime of the request. If only the
second cache were used, then multiple concurrent calls for a fresh result
would cause multiple concurrent requests being made for the same information
in the same time window. With both caches, both of these undesirable outcomes
are avoided.

Additional libraries were considered for implementing the caching here; this
includes using `p-debounce` with the "leading edge" feature enabled (see:
https://github.com/sindresorhus/p-debounce?tab=readme-ov-file#before), but
this didn't seem to simplify the current approach. Some other p-fun libraries
were considered and it should be possible to substitute some combination of
them to implement the result, but our existing lru-memoize library and the
lru-cache library we use in a number of other places work just fine and were
reused here. A future simplification that reduces the maintenance and
comprehension burden is welcome. */
let POLL_CACHE;
let POLL_RESULT_CACHE;

/* Example usage of `poll()` in a route handler:

```
import * as bedrock from '@bedrock/core';

bedrock.events.on('bedrock-express.configure.routes', app => {
  const exchangePoller = createExchangePoller(...);

  const exampleRoute = '/poll/exchanges/:exchangeId';
  app.options(exampleRoute, cors());
  app.post(
    exampleRoute,
    // ensure `exchangeId` is for an appropriate host/workflow, etc.
    validate){bodySchema: ...}),
    asyncHandler(async (req, res) => {
      try {
        const {exchangeId} = req.body;
        const result = await poll({id: exchangeId, poller: exchangePoller});
        // ...
      } catch(e) {
        // ...
      }
    });
});
```
*/

bedrock.events.on('bedrock.init', async () => {
  _createPollCache();
  _createPollResultCache();
});

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
 * @param {boolean} [options.useCache=true] - Set to `false` to avoid using
 *   the poll result cache and to instead get a fresh result.
 *
 * @returns {Promise<object>} An object with the record.
 */
export async function poll({id, poller, useCache = true} = {}) {
  assert.string(id, 'options.id');
  assert.func(poller, 'options.poller');
  assert.optionalBool(useCache, 'options.useCache');

  const result = useCache ? POLL_RESULT_CACHE.get(id) : undefined;
  if(result !== undefined) {
    return result;
  }

  // if new polling op would exceed the cache size, disallow it
  if(POLL_CACHE.cache.size === POLL_CACHE.cache.max && !POLL_CACHE.has(id)) {
    throw new BedrockError('Too many concurrent polling operations.', {
      name: 'QuotaExceededError',
      details: {
        public: true,
        httpStatusCode: 503
      }
    });
  }

  // use `disposeOnSettle` to clear poll operation from cache once completed
  const options = {disposeOnSettle: true};
  const fn = () => _getUncachedPollResult({id, poller});
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
  POLL_CACHE = new LruCache(options);
}

function _createPollResultCache({ttl} = {}) {
  const cfg = bedrock.config.notify;
  const options = {...cfg.caches.pollResult};
  if(ttl !== undefined) {
    options.ttl = ttl;
  }
  POLL_RESULT_CACHE = new LRU(options);
}

async function _getUncachedPollResult({id, poller}) {
  let sequence = 0;
  const currentResult = POLL_RESULT_CACHE.get(id);
  if(currentResult !== undefined) {
    if(!currentResult.mutable) {
      // result is not mutable; update TTL to max and return it
      POLL_RESULT_CACHE.set(id, currentResult, {ttl: MAX_TTL});
      return currentResult;
    }
    sequence = currentResult.sequence;
  }

  // poll resource
  const {mutable, value} = await poller({id, currentResult});

  // if result has not changed, reuse current result but update cache
  let result;
  if(currentResult &&
    value === currentResult.value &&
    mutable === currentResult.mutable) {
    result = currentResult;
  } else {
    // create new result
    result = {id, sequence: sequence + 1, mutable, value};
  }

  // update result cache; use max TTL if result is immutable
  let options;
  if(!mutable) {
    options = {ttl: MAX_TTL};
  }
  POLL_RESULT_CACHE.set(id, result, options);

  return result;
}

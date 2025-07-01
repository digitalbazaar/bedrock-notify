/*!
 * Copyright (c) 2024-2025 Digital Bazaar, Inc. All rights reserved.
 */
// server events helper will poll until result is immutable or signal tripped;
// usage:
/*
import {pollers, serverEvents} from '@bedrock-notify';

const ONE_SECOND = 1000;

const abortController = new AbortController();
const exchangePoller.createExchangePoller({
  capability,
  filterExchange({exchange, previousPollResult}) { ... }
});

// example server events route handler
asyncHandler(async (req, res) => {
  const {exchangeId} = req.params;
  await serverEvents.poll({
    req, res,
    pollId: exchangeId, poller: exchangePoller, pollInterval: ONE_SECOND,
    signal: abortController.signal
  });
});
*/
export async function poll({
  req, res, id, poller, pollInterval, signal
} = {}) {
  res.setHeader('content-type', 'text/event-stream');
  res.setHeader('cache-control', 'no-cache');
  res.setHeader('connection', 'keep-alive');
  res.flushHeaders();
  req.on('close', () => res.end());

  let sequence = -1;
  while(true) {
    let data;
    try {
      const result = await poller({id, poller});
      if(result.sequence > sequence) {
        sequence = result.sequence;
        data = {result: result.value, hasMore: !!result.mutable};
      }
    } catch(error) {
      data = {error};
    }

    // only write `data` if it was generated
    if(data) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }

    // close connection if there are no more updates
    if(!data.hasMore) {
      res.end();
      break;
    }

    await new Promise(r => setTimeout(r, pollInterval));
    if(res.writableEnded) {
      break;
    }

    // if signal has been tripped, abort
    signal?.throwIfAborted();
  }
}

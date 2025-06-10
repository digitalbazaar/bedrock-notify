/*!
 * Copyright (c) 2024-2025 Digital Bazaar, Inc. All rights reserved.
 */
//import * as bedrock from '@bedrock/core';

// FIXME:
//const {util: {BedrockError}} = bedrock;

/*
const ONE_SECOND = 1000;

// example server events route handler
asyncHandler(async (req, res) => {
  const {exchangeId} = req.params;
  await sendServerEvents({
    req, res, pollId: exchangeId,
    poller: exchangePoller, pollInterval: ONE_SECOND
  });
});
*/

// FIXME: rename
// server events helper
export async function sendServerEvents({
  req, res, id, poller, pollInterval
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
        data = {result: result.value};
      }
    } catch(error) {
      data = {error};
    }

    // only write `data` if it was generated
    if(data) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }

    await new Promise(r => setTimeout(r, pollInterval));
    if(res.writableEnded) {
      break;
    }
  }
}

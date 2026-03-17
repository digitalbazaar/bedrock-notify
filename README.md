# bedrock-notify

## Quick Examples

```
npm install @bedrock/notify
```

Example usage of `poll()` in a route handler:

```js
import * as bedrock from '@bedrock/core';
import {poll, pollers} from '@bedrock/notify';

bedrock.events.on('bedrock-express.configure.routes', app => {
  const exchangePoller = pollers.createExchangePoller(...);

  const exampleRoute = '/poll/exchanges/:exchangeId';
  app.options(exampleRoute, cors());
  app.post(
    exampleRoute,
    // ensure `exchangeId` is for an appropriate host/workflow, etc.
    validate({bodySchema: ...}),
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

Example `createExchangePoller(...)`:

```js
// root zcap used here; most cases will use a delegated zcap
const {baseUri} = bedrock.config.server;
const target = `${baseUri}/workflows/1/exchanges`;
const capability = `urn:zcap:root:${encodeURIComponent(target)}`;

const pollExchange = pollers.createExchangePoller({
  capability,
  filterExchange({exchange, previousPollResult}) {
    if(previousPollResult?.value?.exchange?.state === exchange.state) {
      // nothing of interest to update in this use case; other use cases
      // might care to pay attention to per-step/step-internal changes
      return;
    }
    // return only the information that should be accessible to the client
    // in this use case
    return {
      exchange: {
        state: exchange.state,
          result: exchange.variables.results?.verify?.verifiablePresentation
        }
      };
    }
  });
```

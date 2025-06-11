/*!
 * Copyright (c) 2024-2025 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import assert from 'assert-plus';
import crypto from 'node:crypto';
import {logger} from './logger.js';

const {util: {BedrockError}} = bedrock;

const FIFTEEN_MINUTES = 1000 * 60 * 15;

// max clock skew is 5 minutes
const MAX_CLOCK_SKEW = 1000 * 60 * 5;

/* Multikey registry IDs and encoded header values
aes-256 | 0xa2 | 256-bit AES symmetric key
*/
const SUPPORTED_KEY_TYPES = new Map([
  ['aes-256', {header: new Uint8Array([0xa2, 0x01]), size: 32}]
]);

// load HMAC key from config
let HMAC_KEY;
bedrock.events.on('bedrock.init', () => {
  _loadHmacKey();
});

// FIXME: push will trigger a poll, push support has to be requested before
// hand to enable authentication of push token:
// 1. create expires date
// 2. createPushToken({event, expires})
//      - returns push token
// 3. create push callback URL
//      - e.g., <baseUrl>/callbacks/<pushToken>
// 4. optional (create exchange w/callback URL)
// 5. on callback URL route:
//      - call `verifyPushToken({pushToken, expectedEvent})
//      - call `poll({id, poller})`...
// 6. poll can also happen w/server events

/* HMAC callback scheme 1 (involves no workflow service hmac-capability)

NOTE: No binding to particular exchange. A stolen callback URL can be used by
any caller (until the callback URL expires) to cause a valid exchange ID to be
polled (but no results returned to the caller). Other methods that involved
giving a separate/derived HMAC key or an API token to the exchange don't help
mitigate the threat of a stolen callback URL because the extra HMAC signature
or API token travel in the same channel the callback URL would be stolen from;
only introducing a nonce would help with this and that's too complicated as
the callback server then has to track and validate those.

pre: generate HMAC key APP_HMAC for coordinator (used application wide)

To create an exchange:

1. get end of current time window, EXP, (now + clockSkew rounded to duration).
2. signature = APP_HMAC(EXP)
3. url = <baseUrl>/<EXP>/<signature>
4. createExchange({vars: {callback: {url}}})

route handler for <baseUrl>/<EXP>/<signature>
1. valid = (now - clockSkew) < EXP && signature === APP_HMAC(EXP)
2. body = whatever ({exchangeId, ...})

*/

/*

// once on app startup
const exchangePoller = createExchangePoller(...);

// when polling from anywhere
const record = await poll({id: exchangeId, poller: exchangePoller});

// enable push-triggered polling
const expires = new Date(now + ttl);
const pushToken = await createPushToken({event, expires});

// ...

// callback URL route handler
(req, res) => {
  try {
    const {pushToken} = req.params;
    const {exchangeId} = req.body;

    await verifyPushToken({pushToken, expectedEvent: 'exchangeUpdate'});
    const result = await poll({id: exchangeId, poller: exchangePoller});
    // ...
  } catch(e) {
    // 404?
  }
}
*/

/**
 * Creates a push token that can be subsequently used to signal that a
 * particular event has occurred. A push token can be used to create an HTTP
 * callback URL that acts as an event handler that will trigger a particular
 * polling operation for a watched resource.
 *
 * Note: Push tokens are created and bound to a particular event (e.g., an
 * "exchangeUpdate" event that can be used to trigger a polling a VC API
 * exchange). They are NOT bound to a particular resource or event "instance"
 * data. This is a requirement to enable the creation of * push-token-based
 * callback URLs that must be passed when watched resources are first created.
 *
 * Security considerations: A stolen callback URL can be used by any caller
 * (until the callback URL, i.e., push token, expires) to cause a valid
 * resource (e.g., a VC API exchange) to be polled (but no results returned to
 * the caller). Other methods that involve associating a separate/derived HMAC
 * key or an API token with the created resource don't help mitigate the threat
 * of a stolen callback URL because the extra HMAC signature or API token
 * are expected to travel in the same channel as the callback URL. Introducing
 * a nonce that could be signed over when calling the callback URL would help
 * with this, however, that's too complicated as the callback server then has
 * to track and validate those. This is considered a low-risk and minimal DoS
 * threat that is not worth the complexity to mitigate.
 *
 * @param {object} options - Options to use.
 * @param {string} options.event - An event the push token is for, e.g.,
 *   an "exchangeUpdate" event that is to be used to trigger polling a VC API
 *   exchange.
 * @param {Date} options.expires - An expiration date for the push token;
 *   defaults to 15 minutes from creation time if not provided.
 *
 * @returns {Promise<string>} A string expressing the push token.
 */
export async function createPushToken({event, expires} = {}) {
  assert.string(event, 'options.event');
  assert.date(expires, 'options.expires');

  const now = Date.now();
  expires = expires ?? new Date(now + FIFTEEN_MINUTES);

  // JWT-like but shorter; extra JWT complexity not needed, token is opaque to
  // external systems (only understood by the application running this code),
  // the format can change if needed in the future, and push notifications
  // merely trigger polling and push messages can be missed due to arbitrary
  // failures, so already require resilience
  const json = JSON.stringify([event, expires.getTime()]);
  const payload = Buffer.from(json).toString('base64url');

  // hmac expiration time as string to produce push token
  const signature = await _hs256({secret: HMAC_KEY, string: payload});
  const token = `u${payload}.u${signature}`;
  return {token, signature};
}

/**
 * Verifies a push token, ensures it has not expired, and returns the
 * associated event. This function should always be called prior to taking
 * action in response to the event, e.g., prior to executing a `poll()`
 * operation in response to the use of a push token.
 *
 * @param {object} options - Options to use.
 * @param {string} options.pushToken - The push token to verify.
 * @param {string} [options.expectedEvent] - An optional event to expect
 *   to be parsed from the push token.
 *
 * @returns {Promise<object>} An object with the `event` associated with
 *   the push token.
 */
export async function verifyPushToken({pushToken, expectedEvent} = {}) {
  assert.string(pushToken, 'options.pushToken');
  assert.optionalString(expectedEvent, 'options.expectedEvent');

  try {
    const [mbPayload, mbSignature] = pushToken.split('.');
    if(!(mbPayload.startsWith('u') && mbSignature.startsWith('u'))) {
      throw new BedrockError('Invalid push token format.', {
        name: 'SyntaxError',
        details: {
          public: true,
          httpStatusCode: 400
        }
      });
    }

    const [event, expires] = JSON.parse(Buffer.from(mbPayload.slice(0)));
    if(_compareTime({t1: Date.now(), t2: expires}) === 1) {
      throw new BedrockError('Push token has expired.', {
        name: 'ConstraintError',
        details: {
          public: true,
          httpStatusCode: 400
        }
      });
    }

    if(event !== expectedEvent) {
      throw new BedrockError('Push token "expectedEvent" does not match.', {
        name: 'ConstraintError',
        details: {
          public: true,
          httpStatusCode: 400
        }
      });
    }

    const {signature} = createPushToken({event, expires: new Date(expires)});
    if(!crypto.timingSafeEqual(
      Buffer.from(mbSignature.slice(1)), Buffer.from(signature))) {
      throw new BedrockError('Push token signature does not match.', {
        name: 'ConstraintError',
        details: {
          public: true,
          httpStatusCode: 400
        }
      });
    }

    return {event, expires};
  } catch(cause) {
    throw new BedrockError('Invalid push token.', {
      name: 'OperationError',
      cause,
      details: {
        public: true,
        httpStatusCode: 400
      }
    });
  }
}

function _compareTime({t1, t2, maxClockSkew = MAX_CLOCK_SKEW}) {
  // `maxClockSkew` is in seconds, so transform to milliseconds
  if(Math.abs(t1 - t2) < (maxClockSkew * 1000)) {
    // times are equal within the max clock skew
    return 0;
  }
  return t1 < t2 ? -1 : 1;
}

/**
 * HMAC-SHA-256 hashes a string.
 *
 * @param {object} options - The options to use.
 * @param {string} options.secret - The secret key to use.
 * @param {string} options.string - The string to hash.
 *
 * @returns {string} The base64url-encoded hash digest.
 */
async function _hs256({secret, string}) {
  return crypto.createHmac('sha256', secret).update(string).digest('base64url');
}

function _loadKey(secretKeyMultibase) {
  if(!secretKeyMultibase?.startsWith('u')) {
    throw new BedrockError(
      'Unsupported multibase header; ' +
      '"u" for base64url-encoding must be used.', {
        name: 'NotSupportedError',
        details: {
          public: true,
          httpStatusCode: 400
        }
      });
  }

  // check multikey header
  let keyType;
  let secretKey;
  const multikey = Buffer.from(secretKeyMultibase.slice(1), 'base64url');
  for(const [type, {header, size}] of SUPPORTED_KEY_TYPES) {
    if(multikey[0] === header[0] && multikey[1] === header[1]) {
      keyType = type;
      if(multikey.length !== (2 + size)) {
        // intentionally do not report what was detected because a
        // misconfigured secret could have its first two bytes revealed
        throw new BedrockError(
          'Incorrect multikey size or invalid multikey header.', {
            name: 'DataError',
            details: {
              public: true,
              httpStatusCode: 400
            }
          });
      }
      secretKey = multikey.subarray(2);
      break;
    }
  }
  if(keyType === undefined) {
    throw new BedrockError(
      'Unsupported multikey type; only AES-256 is supported.', {
        name: 'NotSupportedError',
        details: {
          public: true,
          httpStatusCode: 400
        }
      });
  }

  return secretKey;
}

// exported for testing purposes only
export function _loadHmacKey() {
  const {hmacKey} = bedrock.config.notify.push;
  if(!hmacKey) {
    logger.info('Push notification is disabled.');
  } else {
    if(!(hmacKey.id && typeof hmacKey.id === 'string')) {
      throw new BedrockError(
        'Invalid HMAC key configuration; key "id" must be a string.', {
          name: 'DataError',
          details: {
            public: true,
            httpStatusCode: 400
          }
        });
    }
    HMAC_KEY = _loadKey(hmacKey.secretKeyMultibase);
    logger.info('Push notification is enabled.');
  }
}

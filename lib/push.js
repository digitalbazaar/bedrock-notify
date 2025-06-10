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
// 2. createPushToken({resourceType, expires})
//      - returns push token
// 3. create push callback URL
//      - e.g., <baseUrl>/callbacks/<pushToken>
// 4. optional (create exchange w/callback URL)
// 5. on callback URL route:
//      - call `verifyPushToken({pushToken, expectedResourceType})
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
// FIXME: rename `resourceType`
const pushToken = await createPushToken({resourceType, expires});

// ...

// callback URL route handler
(req, res) => {
  try {
    const {pushToken} = req.params;
    const {exchangeId} = req.body;

    // FIXME: rename `resourceType`
    const {resourceType} = await verifyPushToken({
      pushToken, expectedResourceType
    });

    const result = await poll({id: exchangeId, poller: exchangePoller});
    // ...
  } catch(e) {
    // 404?
  }
}
*/

/**
 * Creates a push token that can be subsequently registered to trigger a
 * particular polling operation for a watched resource.
 *
 * Note: Push tokens are bound to a particular resource type, but not to a
 * a particular resource, i.e., they can be used with any resource. This is
 * a requirement to enable the creation of push-token-based callback URLs
 * that must be passed when watched resources are first created.
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
 * @param {string} options.resourceType - The type of resource the push token
 *   is for, e.g., "exchange" a push token that is to be used to trigger
 *   polling a VC API exchange.
 * @param {Date} options.expires - An expiration date for the push token;
 *   defaults to 15 minutes from creation time if not provided.
 *
 * @returns {Promise<string>} A string expressing the push token.
 */
export async function createPushToken({resourceType, expires} = {}) {
  // FIXME: rename `resourceType`
  assert.string(resourceType, 'options.resourceType');
  assert.date(expires, 'options.expires');

  const now = Date.now();
  expires = expires ?? new Date(now + FIFTEEN_MINUTES);

  // JWT-like but shorter
  const json = JSON.stringify([resourceType, expires.getTime()]);
  const payload = Buffer.from(json).toString('base64url');

  // hmac expiration time as string to produce push token
  const signature = await _hs256({secret: HMAC_KEY, string: payload});
  const token = `u${payload}.u${signature}`;
  return {token, signature};
}

/**
 * Verifies a push token, ensures it has not expired, and returns the
 * associated resource type. This function should always be called prior to
 * executing a `poll()` operation that was triggered by use of the push token.
 *
 * @param {object} options - Options to use.
 * @param {string} options.pushToken - The push token to verify.
 * @param {string} [options.expectedResourceType] - An optional `resourceType`
 *   to expect in the push token.
 *
 * @returns {Promise<object>} An object with the `resourceType` associated with
 *   the push token.
 */
export async function verifyPushToken({pushToken, expectedResourceType} = {}) {
  assert.string(pushToken, 'options.pushToken');
  assert.optionalString(expectedResourceType, 'options.expectedResourceType');

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

    const [resourceType, expires] = JSON.parse(Buffer.from(mbPayload.slice(0)));
    if(_compareTime({t1: Date.now(), t2: expires}) === 1) {
      throw new BedrockError('Push token has expired.', {
        name: 'ConstraintError',
        details: {
          public: true,
          httpStatusCode: 400
        }
      });
    }

    // FIXME: rename `resourceType`
    if(resourceType !== expectedResourceType) {
      throw new BedrockError('Push token resource type does not match.', {
        name: 'ConstraintError',
        details: {
          public: true,
          httpStatusCode: 400
        }
      });
    }

    const {signature} = createPushToken({
      resourceType, expires: new Date(expires)
    });
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

    return {resourceType, expires};
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

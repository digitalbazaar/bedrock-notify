/*!
 * Copyright (c) 2024-2025 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import assert from 'assert-plus';
import crypto from 'node:crypto';
import {logger} from './logger.js';

const {util: {BedrockError}} = bedrock;

const FIFTEEN_MINUTES = 1000 * 60 * 15;

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

// FIXME: add hmac-based push endpoint infra helper
// FIXME: push will trigger a poll, push support has to be requested before
// hand to enable authentication of push token:
// 1. create expires date
// 2. createPushToken({expires}) return push token (base64url-encoded)
// 3. create push callback URL, e.g., <baseUrl>/callbacks/<exp>/<pushToken>
// 4. optional (create exchange w/callback URL)
// 5. attach push token to resource ID + poller
// 6. when callback URL route call `triggerPoll()` with push token
// 7. poll can also happen w/server events

// FIXME: important:
// `pushToken` MUST be verified when passed to `triggerPoll` as a valid,
// attached push token and either this includes some kind of expiry or a flag
// that indicates whether the `pushToken` is already bound to a resource ID
// (binding can only happen once -- and the ID must match); important that the
// binding must happen after the callback has been created because the callback
// has to be passable for resources that get created w/the callback as a param
// (e.g., VC API exchanges)

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
const pushToken = await createPushToken();
attachPushToken({id, poller: exchangePoller});

// ...

// callback URL route handler
(req, res) => {
  try {
    const {pushToken} = req.params;
    const {exchangeId} = req.body;
    // note no `poller` passed here, must be found via attached `pushToken`
    const result = await triggerPoll({id: exchangeId, pushToken});
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
 * @param {object} options - Options to use.
 * @param {Date} options.expires - An expiration date for the push token;
 *   defaults to 15 minutes from creation time if not provided.
 *
 * @returns {Promise<object>} An object with the record.
 */
export async function createPushToken({expires} = {}) {
  assert.date(expires, 'options.expires');

  const now = Date.now();
  expires = expires ?? new Date(now + FIFTEEN_MINUTES);

  // hmac expiration time as string to produce push token
  const token = await _hs256({
    secret: HMAC_KEY, string: '' + expires.getTime()
  });
  return token;
}

// FIXME: implement `attachPushToken({id, poller, pushToken})`

// FIXME: implement `triggerPoll({id, pushToken})`

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

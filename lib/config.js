/*!
 * Copyright (c) 2024-2025 Digital Bazaar, Inc. All rights reserved.
 */
import {config} from '@bedrock/core';
import {NAMESPACE} from './constants.js';

const cfg = config[NAMESPACE] = {};

cfg.caches = {
  // poll cache is used to manage concurrent requests to poll the same
  // watched resources; there are two caches (this one and the `pollResult`
  // cache) because concurrent requests to get updated results should be made
  // only once, even when ignoring/overwriting what is in the results cache,
  // without two caches, many concurrent requests for a fresh value can be made
  // which is undesirable
  poll: {
    // poll cache entries only last as long as a polling operation executes
    // and the `max` used here will also be used to restrict maximum
    // concurrent polling operations from a given process overall; default is
    // 10000 concurrent polling ops
    max: 10000
  },
  // poll result cache holds the actual results of a polling operation for a
  // period of time, allowing reuse when the freshest value isn't needed
  pollResult: {
    // watched data of up to 10MiB/result = 1GiB of cache at once; but
    // relatively short TTLs
    max: 100,
    // 30 seconds by default; then result will have to be read again; note
    // that immutable results can have longer TTLs set in code
    ttl: 30 * 1000
  }
};

cfg.push = {
  hmacKey: null
  /*
  hmacKey: {
    id: '<a key identifier>',
    secretKeyMultibase: '<multibase encoding of an AES-256 secret key>'
  }*/
};

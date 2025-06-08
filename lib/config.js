/*!
 * Copyright (c) 2024-2025 Digital Bazaar, Inc. All rights reserved.
 */
import {config} from '@bedrock/core';
import {NAMESPACE} from './constants.js';

const cfg = config[NAMESPACE] = {};

// FIXME: one cache is for ensuring that only one polling operation per
// watched resouce is executed concurrently; another cache is used for
// holding the polling result for some period of time
cfg.caches = {
  // poll cache is used to manage concurrent requests to poll the same
  // watched resources
  poll: {
    // poll cache entries only last as long as a polling operation executes
    // and the `max` used here will also be used to restrict maximum
    // concurrent polling operations from a given process overall
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

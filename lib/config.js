/*!
 * Copyright (c) 2024-2025 Digital Bazaar, Inc. All rights reserved.
 */
import {config} from '@bedrock/core';
import {NAMESPACE} from './constants.js';

const cfg = config[NAMESPACE] = {};

cfg.caches = {
  watch: {
    // watch records are very small (few hundred bytes, maybe ~500); for 100K
    // user interactions ~50MiB max
    max: 100000,
    // 30 minutes max; based on some ongoing user interaction/task that will
    // likely only last 5-10 minutes
    ttl: 30 * 60 * 1000
  },
  watchResult: {
    // watched data of up to 10MiB/watch = 1GiB of cache at once; but very
    // short TTLs
    max: 100,
    // 30 seconds max; then watch result will have to be read again
    ttl: 30 * 1000
  }
};

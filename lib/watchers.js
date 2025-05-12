/*!
 * Copyright (c) 2024-2025 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as watches from './watches.js';
import assert from 'assert-plus';
import {logger} from './logger.js';
// FIXME: use in built-in VC exchange watcher
//import {zcapClient} from './zcapClient.js';

const {util: {BedrockError}} = bedrock;

const ONE_HOUR_IN_SECONDS = 60 * 60;
const ONE_SECOND = 1000;

const WATCHERS = new Map();

bedrock.events.on('bedrock.init', async () => {
  // FIXME: register all built-in watchers
});

bedrock.events.on('bedrock.started', async () => {
  await _runWatchers();
});

export function registerWatcher({name, fn} = {}) {
  WATCHERS.set(name, fn);
}

// `ttl` is in seconds
export async function watch({id, watcher, ttl} = {}) {
  assert.string(id, 'options.id');
  assert.string(watcher, 'options.watcher');
  assert.number(ttl, 'options.ttl');

  // 1 hour is max TTL
  if(ttl > ONE_HOUR_IN_SECONDS) {
    throw new BedrockError(`Maximum TTL is "${ONE_HOUR_IN_SECONDS}" seconds.`, {
      name: 'ConstraintError',
      details: {httpStatusCode: 400, public: true}
    });
  }

  // validate that `watcher` is a registered watcher
  if(!WATCHERS.has(watcher)) {
    throw new Error(`Watcher "${watcher}" is not registered.`);
  }

  // create watch
  const expires = new Date(Date.now() + ttl * 1000);
  await watches.create({id, expires});
}

async function _runWatchers() {
  try {
    // FIXME: get uuid()
    // FIXME: mark (lock) N-many watches w/UUID and a short expiry

    // FIXME: fetch marked watches

    // FIXME: run watcher for each marked watch in parallel
  } catch(error) {
    logger.error('Failed to run watchers.', {error});
  } finally {
    // reschedule `_runWatchers` for a future run
    setTimeout(() => _runWatchers(), ONE_SECOND);
  }
}

async function _updateWatchRecord({record, watcher} = {}) {
  try {
    // FIXME: update to watch record must clear/reset watchLock to allow
    // other watchers to update...
  } catch(error) {
    logger.error('Failed to update watch record.', {error});
  }
}

/*!
 * Copyright (c) 2024-2025 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as watches from './watches.js';
import assert from 'assert-plus';
import {logger} from './logger.js';
import {randomUUID as uuid} from 'node:crypto';

const {util: {BedrockError}} = bedrock;

const ONE_HOUR_IN_SECONDS = 60 * 60;
const ONE_SECOND = 1000;
const FIVE_SECONDS = ONE_SECOND * 5;
const WATCHERS = new Map();

// for testing purposes only
let _TEST_RESCHEDULE_TIME_HOOK;
let _TEST_LOCK_EXPIRES_TIME_HOOK;
let _runWatchersTimerId = null;

/* Note: Applications that use this API should add a `bedrock.init` listener
that registers all desired watchers, e.g.:
bedrock.events.on('bedrock.init', async () => {
  registerWatcher({
    name: 'someWatcherName',
    fn: createExchangeWatcher({
      capability,
      filterExchange({record, exchange}) {
        if(record.value.exchange.state === exchange.state) {
          // nothing new to update
          return undefined;
        }
        // return only the information that should be accessible to the client
        return {
          state: exchange.state,
          result: exchange.variables.results.myStepName.verifiablePresentation
        };
      }
    })
  });
});
*/

bedrock.events.on('bedrock.started', async () => {
  await _runWatchers();
});

export function registerWatcher({name, fn} = {}) {
  assert.string(name, 'options.name');
  assert.func(fn, 'options.fn');
  WATCHERS.set(name, fn);
}

/**
 * Creates a watch record.
 *
 * @param {object} options - Options to use.
 * @param {string} options.id - The ID for the watch.
 * @param {string} options.watcher - The name of the watcher for the watch;
 *   this name must have been previously registered with an associated function
 *   by using the `registerWatcher()` method.
 * @param {*} [options.value=null] - Initial value for the watch.
 * @param {number} options.ttl - The maximum number of seconds for which the
 *   watcher will operate.
 *
 * @returns {Promise<object>} An object with the record.
 */
export async function watch({id, watcher, value = null, ttl} = {}) {
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
    throw new Error(
      `Could not add watch; watcher "${watcher}" is not registered.`);
  }

  // create watch
  const expires = new Date(Date.now() + ttl * 1000);
  await watches.create({id, watcher, value, expires});
}

async function _runWatchers() {
  let rescheduleTime = ONE_SECOND;

  try {
    const now = Date.now();
    const expiryTime = _TEST_LOCK_EXPIRES_TIME_HOOK ?
      _TEST_LOCK_EXPIRES_TIME_HOOK() : now + FIVE_SECONDS;
    const watcherLock = {id: uuid(), expires: new Date(expiryTime)};
    const limit = 10;
    const {marked} = await watches.mark({watcherLock, limit});
    if(marked === limit) {
      // while limit reached, keep watching immediately
      rescheduleTime = 0;
    } else if(marked === 0) {
      // no watches found, dampen reschedule time
      rescheduleTime *= 2;
    }

    // fetch marked watches
    const records = await watches.find({
      query: {'meta.watcherLock.id': watcherLock.id},
      options: {limit}
    });

    // run watcher for each marked watch in parallel
    await Promise.all(records.map(async record => {
      const {watch: {watcher}} = record;
      const fn = WATCHERS.get(watcher);
      if(!fn) {
        throw new Error(
          `Could not run watcher "${watcher}"; it is not registered.`);
      }
      const {value} = await fn({record});
      if(value !== undefined) {
        await _updateWatchRecord({record, value});
      }
    }));
  } catch(error) {
    logger.error('Failed to run watchers.', {error});
  } finally {
    // allow customization of reschedule time for tests
    if(_TEST_RESCHEDULE_TIME_HOOK) {
      rescheduleTime = _TEST_RESCHEDULE_TIME_HOOK({rescheduleTime});
    }
    // reschedule `_runWatchers` for a future run
    _runWatchersTimerId = setTimeout(() => _runWatchers(), rescheduleTime);
  }
}

async function _updateWatchRecord({record, value} = {}) {
  try {
    const sequence = record.watch.sequence + 1;
    const watch = {...record.watch, sequence, value};
    await watches.update({watch});
  } catch(error) {
    logger.error('Failed to update watch record.', {error});
  }
}

// exported for testing purposes only
export function _setLockExpiresTimeHook(fn) {
  _TEST_LOCK_EXPIRES_TIME_HOOK = fn;
}
export function _setRescheduleTimeHook(fn) {
  _TEST_RESCHEDULE_TIME_HOOK = fn;
  clearTimeout(_runWatchersTimerId);
  _runWatchers();
}

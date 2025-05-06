/*!
 * Copyright (c) 2024-2025 Digital Bazaar, Inc. All rights reserved.
 */
import * as bedrock from '@bedrock/core';
import * as database from '@bedrock/mongodb';
import assert from 'assert-plus';

const {util: {BedrockError}} = bedrock;

const COLLECTION_NAME = 'notify-watch';

bedrock.events.on('bedrock-mongodb.ready', async () => {
  await database.openCollections([COLLECTION_NAME]);

  const indexes = [{
    collection: COLLECTION_NAME,
    fields: {'watch.id': 1},
    options: {unique: true}
  }, {
    collection: COLLECTION_NAME,
    fields: {'watch.expires': 1},
    options: {
      unique: false,
      // grace period of 24 hours
      expireAfterSeconds: 60 * 60 * 24
    }
  }];

  await database.createIndexes(indexes);
});

/**
 * Creates a watch record.
 *
 * @param {object} options - Options to use.
 * @param {string} options.id - The ID for the watch.
 * @param {Date} [options.expires] - An optional expiration date for the record.
 *
 * @returns {Promise<object>} An object with the record.
 */
export async function create({id, expires} = {}) {
  assert.string(id, 'id');
  assert.optionalDate(expires, 'expires');

  // create `watch` for record
  const watch = {
    id, sequence: 0, value: null, expires
  };

  const now = Date.now();
  const collection = database.collections[COLLECTION_NAME];
  const meta = {created: now, updated: now};
  const record = {watch, meta};

  try {
    await collection.insertOne(record);
    return {watch, meta};
  } catch(e) {
    if(!database.isDuplicateError(e)) {
      throw e;
    }
    throw new BedrockError('Duplicate watch record.', {
      name: 'DuplicateError',
      details: {
        public: true,
        httpStatusCode: 409
      },
      cause: e
    });
  }
}

/**
 * Retrieves all watch records matching the given query.
 *
 * Supported indexes include searching by `watch.id` or `watch.expires`.
 *
 * @param {object} options - The options to use.
 * @param {object} options.query - The optional query to use (default: {}).
 * @param {object} [options.options={}] - Query options (eg: 'sort', 'limit').
 * @param {boolean} [options.explain=false] - An optional explain boolean.
 *
 * @returns {Promise<Array | ExplainObject>} Resolves with the records that
 *   matched the query or returns an ExplainObject if `explain=true`.
 */
export async function find({query = {}, options = {}, explain = false} = {}) {
  const collection = database.collections[COLLECTION_NAME];

  if(explain) {
    const cursor = await collection.find(query, options);
    return cursor.explain('executionStats');
  }

  const records = await collection.find(query, options).toArray();
  return records;
}

/**
 * Retrieves a watch record (if it exists) by its `id`.
 *
 * @param {object} options - Options to use.
 * @param {string} options.id - The ID of the record.
 * @param {boolean} [options.explain=false] - Set to true to return database
 *   query explain information instead of executing database queries.
 *
 * @returns {Promise<object | ExplainObject>} Resolves with the sync
 *   database record or an ExplainObject if `explain=true`.
 */
export async function get({id, explain = false} = {}) {
  assert.string(id, 'id');

  const query = {'watch.id': id};
  const collection = database.collections[COLLECTION_NAME];
  const projection = {_id: 0};

  if(explain) {
    // 'find().limit(1)' is used here because 'findOne()' doesn't return a
    // cursor which allows the use of the explain function.
    const cursor = await collection.find(query, {projection}).limit(1);
    return cursor.explain('executionStats');
  }

  const record = await collection.findOne(query, {projection});
  if(!record) {
    const details = {
      httpStatusCode: 404,
      public: true
    };
    throw new BedrockError('Watch record not found.', {
      name: 'NotFoundError',
      details
    });
  }
  return record;
}

/**
 * Updates (replaces) a watch record if the record's `sequence` is one greater
 * than the existing record.
 *
 * @param {object} options - The options to use.
 * @param {object} options.watch - The new watch data with `id` and `sequence`
 *   minimally set.
 * @param {boolean} [options.explain=false] - An optional explain boolean.
 *
 * @returns {Promise<boolean | ExplainObject>} Resolves with `true` on update
 *   success or an ExplainObject if `explain=true`.
 */
export async function update({watch, explain = false} = {}) {
  // build update
  const now = Date.now();
  const update = {};
  update.$set = {watch, 'meta.updated': now};

  const collection = database.collections[COLLECTION_NAME];
  const query = {
    'watch.id': watch.id,
    'watch.sequence': watch.sequence - 1
  };

  if(explain) {
    // 'find().limit(1)' is used here because 'updateOne()' doesn't return a
    // cursor which allows the use of the explain function.
    const cursor = await collection.find(query).limit(1);
    return cursor.explain('executionStats');
  }

  const result = await collection.updateOne(query, update);
  if(result.modifiedCount > 0) {
    // document modified: success
    return true;
  }

  throw new BedrockError(
    'Could not update watch record. Sequence does not match existing record.', {
      name: 'InvalidStateError',
      details: {
        httpStatusCode: 409,
        public: true,
        expected: watch.sequence - 1
      }
    });
}

/**
 * Deletes a watch record (if it exists).
 *
 * @param {object} options - Options to use.
 * @param {string} options.id - The ID of the record.
 *
 * @returns {Promise} Resolves once the deletion completes.
 */
export async function remove({id} = {}) {
  assert.string(id, 'id');
  const query = {'watch.id': id};
  const collection = database.collections[COLLECTION_NAME];

  await collection.deleteOne(query);
}

/**
 * An object containing information on the query plan.
 *
 * @typedef {object} ExplainObject
 */

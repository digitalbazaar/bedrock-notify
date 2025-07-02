/*!
 * Copyright (c) 2020-2025 Digital Bazaar, Inc. All rights reserved.
 */
import {config} from '@bedrock/core';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import '@bedrock/app-identity';
import '@bedrock/did-io';
import '@bedrock/https-agent';
import '@bedrock/mongodb';
import '@bedrock/notify';
import '@bedrock/vcb-verifier';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config.mocha.options.fullTrace = true;
config.mocha.tests.push(path.join(__dirname, 'mocha'));

// allow self-signed certs in test framework
config['https-agent'].rejectUnauthorized = false;

// disable veres one fetching
config['did-io'].methodOverrides.v1.disableFetch = true;

// mongodb config
config.mongodb.name = 'bedrock_notify_test';
config.mongodb.host = 'localhost';
config.mongodb.port = 27017;
// drop all collections on initialization
config.mongodb.dropCollections = {};
config.mongodb.dropCollections.onInit = true;
config.mongodb.dropCollections.collections = [];

// test hmac key for push token feature
config.notify.push.hmacKey = {
  id: 'urn:test:hmacKey',
  secretKeyMultibase: 'uogHy02QDNPX4GID7dGUSGuYQ_Gv0WOIcpmTuKgt1ZNz7_4'
};

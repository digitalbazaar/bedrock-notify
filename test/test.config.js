/*!
 * Copyright (c) 2020-2025 Digital Bazaar, Inc. All rights reserved.
 */
import {config} from '@bedrock/core';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import '@bedrock/app-identity';
import '@bedrock/did-io';
import '@bedrock/https-agent';
import '@bedrock/notify';
import '@bedrock/vcb-verifier';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config.mocha.options.fullTrace = true;
config.mocha.tests.push(path.join(__dirname, 'mocha'));

// allow self-signed certs in test framework
config['https-agent'].rejectUnauthorized = false;

// disable veres one fetching
config['did-io'].methodOverrides.v1.disableFetch = true;

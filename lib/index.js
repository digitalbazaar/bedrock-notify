/*!
 * Copyright (c) 2024-2025 Digital Bazaar, Inc. All rights reserved.
 */
import {zcapClient} from './zcapClient.js';
import '@bedrock/credentials-context';
import '@bedrock/did-context';
import '@bedrock/security-context';
import '@bedrock/vc-barcodes-context';
import '@bedrock/veres-one-context';

// load config defaults
import './config.js';

// export APIs
export {
  //watch,
  zcapClient
};

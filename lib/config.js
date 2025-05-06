/*!
 * Copyright (c) 2021 Digital Bazaar, Inc. All rights reserved.
 */
import bedrock from 'bedrock';
const {config} = bedrock;

const namespace = 'module-template-http';
const cfg = config[namespace] = {};

const basePath = '/foo';
cfg.routes = {
  basePath
};

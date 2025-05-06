/*!
 * Copyright (c) 2021 Digital Bazaar, Inc. All rights reserved.
 */
import {asyncHandler} from 'bedrock-express';
import bedrock from 'bedrock';
const {config} = bedrock;

bedrock.events.on('bedrock-express.configure.routes', app => {
  const {routes} = config['module-template-http'];
  app.post(
    routes.basePath,
    asyncHandler(async (/*req, res*/) => {
    }));
});

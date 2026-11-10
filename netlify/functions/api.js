const serverless = require('serverless-http');
const { app, initialize } = require('../../index');
const dispatch = serverless(app);
exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  try {
    await initialize();
    // Netlify may supply either the public rewrite path or the function path.
    const prefix = '/.netlify/functions/api';
    const pathname = event.path || event.rawPath || '/';
    const normalized = pathname.startsWith(prefix + '/') ? pathname.slice(prefix.length) : pathname;
    const request = { ...event, path: normalized, ...(event.rawPath ? { rawPath: normalized } : {}) };
    return await dispatch(request, context);
  } catch (error) {
    console.error('API initialization failed', error.name, error.code || '');
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ error: 'The service is not configured or its database is unavailable.' }),
    };
  }
};

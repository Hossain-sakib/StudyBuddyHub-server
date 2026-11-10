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
    let readinessCode = 'DATABASE_STARTUP_FAILED';
    if (error.code === 18 || error.codeName === 'AuthenticationFailed') readinessCode = 'DATABASE_AUTH_FAILED';
    else if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'].includes(error.code)) readinessCode = 'DATABASE_DNS_FAILED';
    else if (error.name === 'MongoServerSelectionError') readinessCode = 'DATABASE_UNREACHABLE';
    else if (error.code === 'CONFIG_MISSING') readinessCode = 'CONFIG_MISSING';
    const isHealth = (event.path || event.rawPath || '').endsWith('/api/health');
    console.error('API initialization failed', error.name, error.code || '');
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ error: 'The service is not configured or its database is unavailable.', ...(isHealth ? { code: readinessCode } : {}) }),
    };
  }
};

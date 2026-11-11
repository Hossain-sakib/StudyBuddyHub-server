const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readiness } = require("../readiness");
test("readiness distinguishes nested database failures without publishing secrets", () => {
  const secret = "mongodb://private-user:private-password@private-host";
  const failure = {
    name: "MongoServerSelectionError",
    message: secret,
    reason: {
      servers: new Map([
        [
          "private-host",
          {
            error: {
              name: "MongoNetworkError",
              message: secret,
              cause: {
                code: "ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR",
                message: secret,
              },
            },
          },
        ],
      ]),
    },
  };
  const status = readiness(failure);
  assert.equal(status.code, "DATABASE_TLS_FAILED");
  assert.equal(status.discoveredServers, 1);
  assert.ok(!JSON.stringify(status).includes("private"));
  assert.equal(readiness({ code: 18 }).code, "DATABASE_AUTH_FAILED");
  assert.equal(readiness({ code: "CONFIG_MISSING" }).code, "CONFIG_MISSING");
  assert.equal(
    readiness({ cause: { code: "ENOTFOUND" } }).code,
    "DATABASE_DNS_FAILED",
  );
  assert.equal(
    readiness({ cause: { code: "ECONNREFUSED" } }).code,
    "DATABASE_NETWORK_FAILED",
  );
});

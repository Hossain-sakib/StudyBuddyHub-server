// Public readiness reports contain fixed categories only, never provider messages,
// connection strings, addresses, certificate details or credentials.
function readiness(error) {
  const codes = new Set();
  const names = new Set();
  function collect(value, depth = 0) {
    if (!value || depth > 5) return;
    if (typeof value.code === "number" || typeof value.code === "string")
      codes.add(String(value.code));
    if (typeof value.name === "string") names.add(value.name);
    collect(value.cause, depth + 1);
  }
  collect(error);
  const servers = error.reason?.servers;
  if (servers instanceof Map)
    for (const server of servers.values()) collect(server.error);
  let code = "DATABASE_STARTUP_FAILED";
  if (codes.has("18") || error.codeName === "AuthenticationFailed")
    code = "DATABASE_AUTH_FAILED";
  else if (codes.has("CONFIG_MISSING")) code = "CONFIG_MISSING";
  else if ([...codes].some((c) => ["ENOTFOUND", "EAI_AGAIN"].includes(c)))
    code = "DATABASE_DNS_FAILED";
  else if (
    [...codes].some(
      (c) =>
        c.startsWith("ERR_SSL") ||
        c.startsWith("ERR_TLS") ||
        [
          "CERT_HAS_EXPIRED",
          "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
          "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
        ].includes(c),
    )
  )
    code = "DATABASE_TLS_FAILED";
  else if (
    [...codes].some((c) =>
      [
        "ECONNREFUSED",
        "ETIMEDOUT",
        "ECONNRESET",
        "ENETUNREACH",
        "EHOSTUNREACH",
      ].includes(c),
    )
  )
    code = "DATABASE_NETWORK_FAILED";
  else if (error.name === "MongoServerSelectionError")
    code = "DATABASE_UNREACHABLE";
  return {
    code,
    ...(servers instanceof Map
      ? {
          discoveredServers: servers.size,
          connectionErrors: [...names].filter((n) =>
            [
              "MongoNetworkError",
              "MongoNetworkTimeoutError",
              "MongoServerSelectionError",
            ].includes(n),
          ),
        }
      : {}),
  };
}
module.exports = { readiness };

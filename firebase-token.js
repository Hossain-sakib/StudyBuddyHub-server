const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const CERT_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
function createGoogleVerifier({ projectId, fetchKeys } = {}) {
  let cached;
  let expires = 0;
  const project =
    projectId || process.env.FIREBASE_PROJECT_ID || "studdy-buddy-hub-8cc52";
  const download =
    fetchKeys ||
    (async () => {
      const response = await fetch(CERT_URL, {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error("Identity verification is unavailable");
      return response.json();
    });
  return async (token) => {
    if (typeof token !== "string" || token.length > 16000)
      throw new Error("Invalid identity token");
    const decoded = jwt.decode(token, { complete: true });
    if (
      !decoded ||
      decoded.header.alg !== "RS256" ||
      typeof decoded.header.kid !== "string"
    )
      throw new Error("Invalid identity token");
    if (!cached || Date.now() >= expires) {
      cached = await download();
      expires = Date.now() + 30 * 60 * 1000;
    }
    const key = cached.keys?.find(
      (k) => k.kid === decoded.header.kid && k.kty === "RSA",
    );
    if (!key) {
      expires = 0;
      throw new Error("Unknown identity signing key. Please retry.");
    }
    const claims = jwt.verify(
      token,
      crypto.createPublicKey({ key, format: "jwk" }),
      {
        algorithms: ["RS256"],
        audience: project,
        issuer: `https://securetoken.google.com/${project}`,
      },
    );
    const now = Math.floor(Date.now() / 1000);
    if (
      !Number.isFinite(claims.exp) ||
      !Number.isFinite(claims.iat) ||
      claims.iat > now ||
      !Number.isFinite(claims.auth_time) ||
      claims.auth_time > now
    )
      throw new Error("Invalid identity token timestamps");
    if (
      typeof claims.sub !== "string" ||
      !claims.sub ||
      claims.sub.length > 128 ||
      claims.email_verified !== true ||
      typeof claims.email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email) ||
      claims.email.length > 254 ||
      claims.firebase?.sign_in_provider !== "google.com"
    )
      throw new Error("A verified Google account is required");
    return {
      uid: claims.sub,
      email: claims.email.toLowerCase(),
      name:
        typeof claims.name === "string"
          ? claims.name.slice(0, 50).trim()
          : "Learner",
    };
  };
}
module.exports = { createGoogleVerifier };

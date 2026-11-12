/**
 * A stand-in for Google's OpenID provider on 127.0.0.1: discovery document,
 * JWKS and token endpoint. The ID token it returns is signed with a real RSA
 * key published in its JWKS, so openid-client verifies it exactly as it would
 * Google's.
 *
 * The test plays the browser and Google's consent screen: it takes the
 * authorization URL from /auth/oidc/start, calls `authorize(url, claims)` to
 * get the code Google would send back, then calls the callback.
 *
 * `authorize` records the PKCE challenge and nonce for the code; the token
 * endpoint refuses a code_verifier that does not match. Each claim set can
 * override any ID token claim, or ask for the token to be signed with a key
 * that is not in the JWKS (`sign: "foreign"`).
 */
const http = require("http");
const crypto = require("crypto");
const JWT = require("jsonwebtoken");

const KID = "test-key-1";

async function startFakeOidcProvider({ clientId = "test-client-id" } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const foreign = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" };

  const codes = new Map();
  const requests = { token: 0 };
  let issuer;

  const server = http.createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/.well-known/openid-configuration")
      return send(200, {
        issuer,
        authorization_endpoint: `${issuer}/o/oauth2/v2/auth`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/certs`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: [
          "client_secret_basic",
          "client_secret_post",
        ],
        scopes_supported: ["openid", "email", "profile"],
      });
    if (req.url === "/certs") return send(200, { keys: [jwk] });
    if (req.url === "/token" && req.method === "POST") {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        requests.token++;
        const form = new URLSearchParams(raw);
        const grant = codes.get(form.get("code"));
        if (!grant) return send(400, { error: "invalid_grant" });
        codes.delete(form.get("code"));
        const challenge = crypto
          .createHash("sha256")
          .update(form.get("code_verifier") || "")
          .digest("base64url");
        if (challenge !== grant.codeChallenge)
          return send(400, { error: "invalid_grant", error_description: "PKCE" });

        const now = Math.floor(Date.now() / 1000);
        const { sign, ...overrides } = grant.claims;
        const claims = {
          iss: issuer,
          aud: clientId,
          sub: "google-sub-1",
          email: "jane@vironix.ai",
          email_verified: true,
          hd: "vironix.ai",
          nonce: grant.nonce,
          iat: now,
          exp: now + 3600,
          ...overrides,
        };
        for (const [key, value] of Object.entries(claims))
          if (value === undefined) delete claims[key];
        const key = sign === "foreign" ? foreign.privateKey : privateKey;
        const idToken = JWT.sign(claims, key, {
          algorithm: "RS256",
          keyid: KID,
        });
        send(200, {
          access_token: "test-access-token",
          token_type: "Bearer",
          expires_in: 3600,
          id_token: idToken,
        });
      });
      return;
    }
    send(404, { error: "not_found" });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  issuer = `http://127.0.0.1:${server.address().port}`;

  return {
    issuer,
    clientId,
    requests,
    /**
     * Plays Google's consent screen for an authorization URL from
     * /auth/oidc/start. Returns the `state` and `code` Google would send back.
     * @param {string} authorizationUrl
     * @param {Object} claims - ID token claim overrides, plus `sign: "foreign"`
     */
    authorize(authorizationUrl, claims = {}) {
      const url = new URL(authorizationUrl);
      const code = crypto.randomBytes(16).toString("hex");
      codes.set(code, {
        nonce: url.searchParams.get("nonce"),
        codeChallenge: url.searchParams.get("code_challenge"),
        claims,
      });
      return { code, state: url.searchParams.get("state"), url };
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

module.exports = { startFakeOidcProvider };

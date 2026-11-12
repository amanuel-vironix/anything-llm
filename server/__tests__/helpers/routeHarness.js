/**
 * Runs Express route handlers registered by an `xxxEndpoints(app)` function
 * without a server: middleware chain included, against a recording response.
 *
 *   const routes = captureRoutes(inviteEndpoints);
 *   const res = await routes.call("POST", "/invite/:code", {
 *     params: { code }, body: { username, password },
 *   });
 *   expect(res.body).toEqual(...)
 */

function captureRoutes(register) {
  const routes = new Map();
  const app = {};
  for (const method of ["get", "post", "put", "patch", "delete"]) {
    app[method] = (path, ...handlers) => {
      routes.set(`${method.toUpperCase()} ${path}`, handlers.flat());
    };
  }
  app.ws = () => {};
  register(app);

  return {
    routes,
    /**
     * @param {string} method
     * @param {string} path - the route pattern as registered
     * @param {{params?: Object, query?: Object, body?: any, headers?: Object, cookies?: Object, signedCookies?: Object, ip?: string}} req
     */
    call: async (method, path, req = {}) => {
      const handlers = routes.get(`${method} ${path}`);
      if (!handlers) throw new Error(`No route ${method} ${path}`);
      const request = makeRequest(req);
      const response = makeResponse();
      for (const handler of handlers) {
        let nextCalled = false;
        await handler(request, response, () => {
          nextCalled = true;
        });
        if (!nextCalled) break;
      }
      return response;
    },
  };
}

function makeRequest({
  params = {},
  query = {},
  body = undefined,
  headers = {},
  cookies = {},
  signedCookies = {},
  ip = "127.0.0.1",
} = {}) {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
  );
  return {
    params,
    query,
    // reqBody() reads request.body and JSON-parses strings.
    body: body === undefined ? {} : body,
    headers: lower,
    cookies,
    signedCookies,
    ip,
    header: (name) => lower[String(name).toLowerCase()],
    get: (name) => lower[String(name).toLowerCase()],
  };
}

function makeResponse() {
  const res = {
    statusCode: 200,
    body: undefined,
    redirectedTo: null,
    cookies: {},
    clearedCookies: [],
    headers: {},
    locals: {},
    ended: false,
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.sendStatus = (code) => {
    res.statusCode = code;
    res.ended = true;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    res.ended = true;
    return res;
  };
  res.send = (body) => {
    res.body = body;
    res.ended = true;
    return res;
  };
  res.end = () => {
    res.ended = true;
    return res;
  };
  res.redirect = (statusOrUrl, maybeUrl) => {
    if (maybeUrl === undefined) {
      res.statusCode = 302;
      res.redirectedTo = statusOrUrl;
    } else {
      res.statusCode = statusOrUrl;
      res.redirectedTo = maybeUrl;
    }
    res.ended = true;
    return res;
  };
  res.cookie = (name, value, options = {}) => {
    res.cookies[name] = { value, options };
    return res;
  };
  res.clearCookie = (name, options = {}) => {
    res.clearedCookies.push({ name, options });
    return res;
  };
  res.setHeader = (name, value) => {
    res.headers[String(name).toLowerCase()] = value;
    return res;
  };
  res.set = res.setHeader;
  return res;
}

module.exports = { captureRoutes };

// The window loads the app from http://127.0.0.1:<port>/, and the browser keeps
// localStorage per origin — port included. A new random port on every launch was a new,
// empty origin each time: theme, language, reader settings and the disguise skin were all
// forgotten when the app restarted. The port is kept in userData and reused while it is
// free. When something else holds it for a while, this launch runs on another port, but the
// saved one is kept: the next launch goes back to it, and to everything stored under it.
const fs = require("fs");
const net = require("net");

// Both tried the way src/server.ts listens (every interface, no host), so "free" here means
// the server can really take it.
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, () => srv.close(() => resolve(true)));
  });
}

function readSavedPort(file) {
  try {
    const port = JSON.parse(fs.readFileSync(file, "utf8")).port;
    return Number.isInteger(port) && port > 1024 && port < 65536 ? port : null;
  } catch {
    return null;
  }
}

// `isFree`/`findFree` are injectable so the choice can be tested without opening sockets.
async function choosePort(file, { isFree = isPortFree, findFree = findFreePort } = {}) {
  const saved = readSavedPort(file);
  if (saved !== null && (await isFree(saved))) return saved;
  const port = await findFree();
  if (saved !== null) return port;
  try {
    fs.writeFileSync(file, JSON.stringify({ port }));
  } catch {
    /* Not remembered: the next launch picks again, as it always did */
  }
  return port;
}

module.exports = { choosePort, findFreePort, isPortFree, readSavedPort };

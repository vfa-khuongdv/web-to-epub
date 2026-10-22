// The window loads the app from http://127.0.0.1:<port>/, and the browser keeps
// localStorage per origin — port included. A new random port on every launch was a new,
// empty origin each time: theme, language, reader settings and the disguise skin were all
// forgotten when the app restarted. The port is kept in userData and reused while it is
// free. When something else holds it for a while, this launch runs on another port, but the
// saved one is kept: the next launch goes back to it, and to everything stored under it.
// Installs from main have no port.json and used 45813, so preserve that origin too.
const fs = require("fs");
const net = require("net");

const PREFERRED_PORT = 45813;

// Probe the loopback interface used by the desktop server.
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
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
  const preferred = saved ?? PREFERRED_PORT;
  // A temporary fallback must not replace either an existing saved origin or main's
  // default origin. Once the preferred port is free, the next launch returns to it.
  if (!(await isFree(preferred))) return findFree();
  if (saved !== null) return saved;
  try {
    fs.writeFileSync(file, JSON.stringify({ port: preferred }));
  } catch {
    /* Not remembered: the next launch tries the same default port again. */
  }
  return preferred;
}

module.exports = { choosePort, findFreePort, isPortFree, readSavedPort };

const SecretStack = require('secret-stack');
const ssbKeys = require('ssb-keys');
const path = require('path');
const caps = require('ssb-caps');
const fs = require('fs');
const os = require('os');

module.exports = function Testbot(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test'));
  const keys = opts.keys || ssbKeys.loadOrCreateSync(path.join(dir, 'secret'));

  return SecretStack({ appKey: caps.shs })
    .use(require('ssb-db2'))
    .use(require('ssb-friends'))
    .use(require('../lib/index'))
    .call(null, { path: dir, keys });
};

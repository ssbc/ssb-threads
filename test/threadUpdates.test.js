const test = require('tape');
const pull = require('pull-stream');
const ssbKeys = require('ssb-keys');
const pullAsync = require('pull-async');
const Testbot = require('./testbot');
const wait = require('./wait');

const lucyKeys = ssbKeys.generate(null, 'lucy');
const maryKeys = ssbKeys.generate(null, 'mary');

test('threads.threadUpdates notifies of new reply to that thread', (t) => {
  const ssb = Testbot({ keys: lucyKeys });

  let updates = 0;
  let liveDrainer;

  pull(
    pullAsync((cb) => {
      ssb.db.create(
        {
          keys: lucyKeys,
          content: { type: 'post', text: 'A: root' },
        },
        wait(cb, 800),
      );
    }),
    pull.asyncMap((rootMsg, cb) => {
      pull(
        ssb.threads.threadUpdates({ root: rootMsg.key }),
        (liveDrainer = pull.drain((msg) => {
          t.equals(msg.value.content.root, rootMsg.key, 'got update');
          updates++;
        })),
      );

      setTimeout(() => {
        t.equals(updates, 0);
        ssb.db.create(
          {
            keys: maryKeys,
            content: { type: 'post', text: 'A: 2nd', root: rootMsg.key },
          },
          wait(cb, 800),
        );
      }, 300);
    }),
    pull.asyncMap((_, cb) => {
      t.equals(updates, 1);
      ssb.db.create(
        {
          keys: maryKeys,
          content: { type: 'post', text: 'B: root' },
        },
        wait(cb, 800),
      );
    }),
    pull.asyncMap((msg3, cb) => {
      t.equals(updates, 1);
      ssb.db.create(
        {
          keys: lucyKeys,
          content: { type: 'post', text: 'B: 2nd', root: msg3.key },
        },
        wait(cb, 800),
      );
    }),

    pull.drain(() => {
      t.equals(updates, 1);
      liveDrainer.abort();
      ssb.close(t.end);
    }),
  );
});

test('threads.threadUpdates (by default) cannot see private replies', (t) => {
  const ssb = Testbot({ keys: lucyKeys });

  let updates = 0;
  let liveDrainer;

  pull(
    pullAsync((cb) => {
      ssb.db.create(
        {
          keys: lucyKeys,
          content: { type: 'post', text: 'A: root' },
          recps: [lucyKeys.id, maryKeys.id],
          encryptionFormat: 'box',
        },
        wait(cb),
      );
    }),
    pull.asyncMap((rootMsg, cb) => {
      pull(
        ssb.threads.threadUpdates({ root: rootMsg.key }),
        (liveDrainer = pull.drain((m) => {
          t.fail('should not get an update');
          updates++;
        })),
      );

      setTimeout(() => {
        t.equals(updates, 0);
        ssb.db.create(
          {
            keys: maryKeys,
            content: { type: 'post', text: 'A: 2nd', root: rootMsg.key },
            recps: [lucyKeys.id, maryKeys.id],
            encryptionFormat: 'box',
          },
          wait(cb),
        );
      }, 300);
    }),
    pull.asyncMap((_, cb) => {
      t.equals(updates, 0);
      ssb.db.create(
        {
          keys: maryKeys,
          content: { type: 'post', text: 'B: root' },
          recps: [lucyKeys.id, maryKeys.id],
          encryptionFormat: 'box',
        },
        wait(cb),
      );
    }),
    pull.asyncMap((msg3, cb) => {
      t.equals(updates, 0);
      ssb.db.create(
        {
          keys: lucyKeys,
          content: { type: 'post', text: 'B: 2nd', root: msg3.key },
          recps: [lucyKeys.id, maryKeys.id],
          encryptionFormat: 'box',
        },
        wait(cb),
      );
    }),

    pull.drain(() => {
      t.equals(updates, 0);
      liveDrainer.abort();
      ssb.close(t.end);
    }),
  );
});

test('threads.threadUpdates can view private replies given opts.private', (t) => {
  const ssb = Testbot({ keys: lucyKeys });

  let updates = 0;
  let liveDrainer;

  pull(
    pullAsync((cb) => {
      ssb.db.create(
        {
          keys: lucyKeys,
          content: { type: 'post', text: 'A: root' },
          recps: [lucyKeys.id, maryKeys.id],
          encryptionFormat: 'box',
        },
        wait(cb, 800),
      );
    }),
    pull.asyncMap((rootMsg, cb) => {
      pull(
        ssb.threads.threadUpdates({ root: rootMsg.key, private: true }),
        (liveDrainer = pull.drain((msg) => {
          t.equals(msg.value.content.root, rootMsg.key, 'got update');
          updates++;
        })),
      );

      setTimeout(() => {
        t.equals(updates, 0);
        ssb.db.create(
          {
            keys: maryKeys,
            content: { type: 'post', text: 'A: 2nd', root: rootMsg.key },
            recps: [lucyKeys.id, maryKeys.id],
            encryptionFormat: 'box',
          },
          wait(cb, 800),
        );
      }, 300);
    }),
    pull.asyncMap((_, cb) => {
      t.equals(updates, 1);
      ssb.db.create(
        {
          keys: maryKeys,
          content: { type: 'post', text: 'B: root' },
          recps: [lucyKeys.id, maryKeys.id],
          encryptionFormat: 'box',
        },
        wait(cb, 800),
      );
    }),
    pull.asyncMap((msg3, cb) => {
      t.equals(updates, 1);
      ssb.db.create(
        {
          keys: lucyKeys,
          content: { type: 'post', text: 'B: 2nd', root: msg3.key },
          recps: [lucyKeys.id, maryKeys.id],
          encryptionFormat: 'box',
        },
        wait(cb, 800),
      );
    }),

    pull.drain(() => {
      t.equals(updates, 1);
      liveDrainer.abort();
      ssb.close(t.end);
    }),
  );
});

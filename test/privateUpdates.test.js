const test = require('tape');
const pull = require('pull-stream');
const ssbKeys = require('ssb-keys');
const pullAsync = require('pull-async');
const Testbot = require('./testbot');
const wait = require('./wait');

const lucyKeys = ssbKeys.generate(null, 'lucy');
const maryKeys = ssbKeys.generate(null, 'mary');

test('threads.privateUpdates notifies of new thread or new msg', (t) => {
  const ssb = Testbot({ keys: lucyKeys });

  let updates = 0;
  let liveDrainer;
  pull(
    ssb.threads.privateUpdates({}),
    (liveDrainer = pull.drain(() => {
      updates++;
    })),
  );

  let msg1, msg3;
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
    pull.asyncMap((msg, cb) => {
      msg1 = msg;
      t.equals(updates, 0);
      ssb.db.create(
        {
          keys: maryKeys,
          content: { type: 'post', text: 'A: 2nd', root: msg1.key },
          recps: [lucyKeys.id, maryKeys.id],
          encryptionFormat: 'box',
        },
        wait(cb, 800),
      );
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
    pull.asyncMap((msg, cb) => {
      msg3 = msg;
      t.equals(updates, 2);
      ssb.db.create(
        {
          keys: lucyKeys,
          content: { type: 'post', text: 'B: 2nd', root: msg3.key },
          recps: [lucyKeys.id, maryKeys.id],
        },
        wait(cb),
      );
    }),

    pull.drain(() => {
      t.equals(updates, 2);
      liveDrainer.abort();
      ssb.close(t.end);
    }),
  );
});

test('threads.privateUpdates respects includeSelf', (t) => {
  const ssb = Testbot({ keys: lucyKeys });

  let updates = 0;
  let liveDrainer;
  pull(
    ssb.threads.privateUpdates({ includeSelf: true }),
    (liveDrainer = pull.drain(() => {
      updates++;
    })),
  );

  let msg1, msg3;
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
    pull.asyncMap((msg, cb) => {
      msg1 = msg;
      t.equals(updates, 1);
      ssb.db.create(
        {
          keys: maryKeys,
          content: { type: 'post', text: 'A: 2nd', root: msg1.key },
          recps: [lucyKeys.id, maryKeys.id],
          encryptionFormat: 'box',
        },
        wait(cb, 800),
      );
    }),
    pull.asyncMap((_, cb) => {
      t.equals(updates, 2);
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
    pull.asyncMap((msg, cb) => {
      msg3 = msg;
      t.equals(updates, 3);
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
      t.equals(updates, 4);
      liveDrainer.abort();
      ssb.close(t.end);
    }),
  );
});

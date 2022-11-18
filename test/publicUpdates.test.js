const test = require('tape');
const pull = require('pull-stream');
const ssbKeys = require('ssb-keys');
const pullAsync = require('pull-async');
const Testbot = require('./testbot');
const wait = require('./wait');

const lucyKeys = ssbKeys.generate(null, 'lucy');
const maryKeys = ssbKeys.generate(null, 'mary');
const aliceKeys = ssbKeys.generate(null, 'alice');

test('threads.publicUpdates notifies of new thread or new msg', (t) => {
  const ssb = Testbot({
    keys: lucyKeys,
  });

  let updates = [];

  let liveDrainer;
  pull(
    ssb.threads.publicUpdates({}),
    (liveDrainer = pull.drain((msgKey) => {
      updates.push(msgKey);
    })),
  );

  let msg1, msg2, msg3;
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
    pull.asyncMap((msg, cb) => {
      msg1 = msg;
      t.equals(updates.length, 0);
      ssb.db.create(
        {
          keys: maryKeys,
          content: { type: 'post', text: 'A: 2nd', root: msg1.key },
        },
        wait(cb, 800),
      );
    }),
    pull.asyncMap((msg, cb) => {
      msg2 = msg;
      t.equals(updates.length, 1);
      t.equals(updates[0], msg2.key);
      ssb.db.create(
        {
          keys: maryKeys,
          content: { type: 'post', text: 'B: root' },
        },
        wait(cb, 800),
      );
    }),
    pull.asyncMap((msg, cb) => {
      msg3 = msg;
      t.equals(updates.length, 2);
      t.equals(updates[1], msg3.key);
      ssb.db.create(
        {
          keys: lucyKeys,
          content: { type: 'post', text: 'B: 2nd', root: msg3.key },
        },
        wait(cb, 800),
      );
    }),

    pull.drain(() => {
      t.equals(updates.length, 2, 'total updates');
      liveDrainer.abort();
      ssb.close(t.end);
    }),
  );
});

test('threads.publicUpdates respects includeSelf opt', (t) => {
  const ssb = Testbot({
    keys: lucyKeys,
  });

  let updates = 0;

  let liveDrainer;
  pull(
    ssb.threads.publicUpdates({ includeSelf: true }),
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
        },
        wait(cb, 800),
      );
    }),

    pull.drain(() => {
      t.equals(updates, 4, 'total updates');
      liveDrainer.abort();
      ssb.close(t.end);
    }),
  );
});

test('threads.publicUpdates ignores replies to unknown roots', (t) => {
  const ssb = Testbot({
    keys: lucyKeys,
  });

  let updates = [];

  let liveDrainer;
  pull(
    ssb.threads.publicUpdates({}),
    (liveDrainer = pull.drain((msgKey) => {
      updates.push(msgKey);
    })),
  );

  let msg1, msg2;
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
    pull.asyncMap((msg, cb) => {
      msg1 = msg;
      t.equals(updates.length, 0);

      ssb.db.create(
        {
          keys: maryKeys,
          content: { type: 'post', text: 'A: 2nd', root: msg1.key },
        },
        wait(cb, 800),
      );
    }),
    pull.asyncMap((msg, cb) => {
      msg2 = msg;
      t.equals(updates.length, 1);
      t.equals(updates[0], msg2.key);

      ssb.db.create(
        {
          keys: maryKeys,
          content: {
            type: 'post',
            text: 'B: 2nd',
            root: `%${Buffer.alloc(32, 'deadbeef').toString('base64')}.sha256`,
          },
        },
        wait(cb, 800),
      );
    }),

    pull.drain(() => {
      t.equals(updates.length, 1, 'total updates');
      liveDrainer.abort();
      ssb.close(t.end);
    }),
  );
});

test('threads.publicUpdates respects following opt', (t) => {
  const ssb = Testbot({ keys: lucyKeys });

  let updates = [];

  let liveDrainer;
  pull(
    ssb.threads.publicUpdates({ following: true }),
    (liveDrainer = pull.drain((msgKey) => {
      updates.push(msgKey);
    })),
  );

  let msg1, msg2, msg3, msg4, msg5;
  pull(
    pullAsync((cb) => {
      ssb.db.publish(
        { type: 'contact', contact: maryKeys.id, following: true },
        cb,
      );
    }),
    pull.asyncMap((_, cb) => {
      ssb.db.create(
        { content: { type: 'post', text: 'Root post from Lucy' } },
        cb,
        wait(cb, 800),
      );
    }),
    pull.asyncMap((msg, cb) => {
      msg1 = msg;
      t.equals(updates.length, 0);
      ssb.db.create(
        {
          keys: maryKeys,
          content: {
            type: 'post',
            text: 'Reply to Lucy root from Mary',
            root: msg1.key,
          },
        },
        wait(cb, 800),
      );
    }),
    pull.asyncMap((msg, cb) => {
      msg2 = msg;
      t.equals(updates.length, 1);
      t.equals(updates[0], msg2.key);
      ssb.db.create(
        {
          keys: maryKeys,
          content: { type: 'post', text: 'Root post from Mary' },
        },
        wait(cb, 800),
      );
    }),
    pull.asyncMap((msg, cb) => {
      msg3 = msg;
      t.equals(updates.length, 2);
      t.equals(updates[1], msg3.key);
      ssb.db.create(
        {
          keys: aliceKeys,
          content: {
            type: 'post',
            text: 'Reply to Mary root from Alice',
            root: msg3.key,
          },
        },
        wait(cb, 800),
      );
    }),

    // Following db.create calls should NOT trigger an update
    pull.asyncMap((msg, cb) => {
      msg4 = msg;
      t.equals(updates.length, 3);
      t.equals(updates[2], msg4.key);

      ssb.db.create(
        {
          keys: aliceKeys,
          content: {
            type: 'post',
            text: 'Root post from Alice',
          },
        },
        wait(cb, 800),
      );
    }),
    pull.asyncMap((msg, cb) => {
      msg5 = msg;
      t.equals(updates.length, 3);
      t.equals(updates[2], msg4.key);

      ssb.db.create(
        {
          keys: maryKeys,
          content: {
            type: 'post',
            text: 'Reply to Alice from Mary',
            root: msg5.key,
          },
        },
        wait(cb, 800),
      );
    }),

    pull.drain(() => {
      t.equals(updates.length, 3, 'total updates');
      liveDrainer.abort();
      ssb.close(t.end);
    }),
  );
});

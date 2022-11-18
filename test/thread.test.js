const test = require('tape');
const pull = require('pull-stream');
const ssbKeys = require('ssb-keys');
const pullAsync = require('pull-async');
const cat = require('pull-cat');
const Testbot = require('./testbot');

const lucyKeys = ssbKeys.generate(null, 'lucy');

test('threads.thread gives one full thread', (t) => {
  const ssb = Testbot({ keys: lucyKeys });

  let rootAkey;
  pull(
    pullAsync((cb) => {
      ssb.db.publish({ type: 'post', text: 'A: root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      rootAkey = rootMsg.key;
      ssb.db.publish({ type: 'post', text: 'A: 2nd', root: rootMsg.key }, cb);
    }),
    pull.asyncMap((prevMsg, cb) => {
      const rootKey = prevMsg.value.content.root;
      ssb.db.publish({ type: 'post', text: 'A: 3rd', root: rootKey }, cb);
    }),

    pull.map(() => ssb.threads.thread({ root: rootAkey })),
    pull.flatten(),

    pull.collect((err, threads) => {
      t.error(err, 'no error');
      t.equals(threads.length, 1, 'one thread');
      const thread = threads[0];
      t.equals(thread.full, true, 'thread comes back full');
      t.equals(thread.messages.length, 3, 'thread has 3 messages');
      t.equals(thread.messages[0].value.content.text, 'A: root', 'root msg ok');
      t.equals(thread.messages[1].value.content.text, 'A: 2nd', '2nd msg ok');
      t.equals(thread.messages[2].value.content.text, 'A: 3rd', '3rd msg ok');
      ssb.close(t.end);
    }),
  );
});

test('threads.thread can be called twice consecutively (to use cache)', (t) => {
  const ssb = Testbot({ keys: lucyKeys });

  let rootAkey;
  pull(
    pullAsync((cb) => {
      ssb.db.publish({ type: 'post', text: 'A: root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      rootAkey = rootMsg.key;
      ssb.db.publish({ type: 'post', text: 'A: 2nd', root: rootMsg.key }, cb);
    }),
    pull.asyncMap((prevMsg, cb) => {
      const rootKey = prevMsg.value.content.root;
      ssb.db.publish({ type: 'post', text: 'A: 3rd', root: rootKey }, cb);
    }),

    pull.map(() =>
      cat([
        ssb.threads.thread({ root: rootAkey }),
        ssb.threads.thread({ root: rootAkey }),
      ]),
    ),
    pull.flatten(),

    pull.collect((err, threads) => {
      t.error(err, 'no error');
      t.equals(threads.length, 2, 'two threads');

      const t1 = threads[0];
      t.equals(t1.full, true, 'thread 1 comes back full');
      t.equals(t1.messages.length, 3, 'thread 1 has 3 messages');
      t.equals(t1.messages[0].value.content.text, 'A: root', 'root msg ok');
      t.equals(t1.messages[1].value.content.text, 'A: 2nd', '2nd msg ok');
      t.equals(t1.messages[2].value.content.text, 'A: 3rd', '3rd msg ok');

      const t2 = threads[0];
      t.equals(t2.full, true, 'thread 2 comes back full');
      t.equals(t2.messages[0].key, t1.messages[0].key, 'same root as before');
      t.equals(t2.messages.length, 3, 'thread 2 has 3 messages');
      t.equals(t2.messages[0].value.content.text, 'A: root', 'root msg ok');
      t.equals(t2.messages[1].value.content.text, 'A: 2nd', '2nd msg ok');
      t.equals(t2.messages[2].value.content.text, 'A: 3rd', '3rd msg ok');
      ssb.close(t.end);
    }),
  );
});

test('threads.thread (by default) cannot view private conversations', (t) => {
  const ssb = Testbot({ keys: lucyKeys });

  let rootKey;

  pull(
    pullAsync((cb) => {
      ssb.db.create(
        {
          keys: lucyKeys,
          content: { type: 'post', text: 'Secret thread root' },
          recps: [ssb.id],
          encryptionFormat: 'box',
        },
        cb,
      );
    }),
    pull.asyncMap((rootMsg, cb) => {
      rootKey = rootMsg.key;
      ssb.db.create(
        {
          keys: lucyKeys,
          content: {
            type: 'post',
            text: 'Second secret message',
            root: rootKey,
          },
          recps: [ssb.id],
          encryptionFormat: 'box',
        },
        cb,
      );
    }),
    pull.asyncMap((_prevMsg, cb) => {
      ssb.db.create(
        {
          keys: lucyKeys,
          content: {
            type: 'post',
            text: 'Third secret message',
            root: rootKey,
          },
          recps: [ssb.id],
          encryptionFormat: 'box',
        },
        cb,
      );
    }),
    pull.map(() => ssb.threads.thread({ root: rootKey })),
    pull.flatten(),

    pull.collect((err, threads) => {
      t.error(err, 'no error');
      t.equals(threads.length, 0, 'no threads arrived');
      ssb.close(t.end);
    }),
  );
});

test('threads.thread can view private conversations given opts.private', (t) => {
  const ssb = Testbot({ keys: lucyKeys });

  let rootKey;

  pull(
    pullAsync((cb) => {
      ssb.db.create(
        {
          keys: lucyKeys,
          content: { type: 'post', text: 'Secret thread root' },
          recps: [ssb.id],
          encryptionFormat: 'box',
        },
        cb,
      );
    }),
    pull.asyncMap((rootMsg, cb) => {
      rootKey = rootMsg.key;
      ssb.db.create(
        {
          keys: lucyKeys,
          content: {
            type: 'post',
            text: 'Second secret message',
            root: rootKey,
          },
          recps: [ssb.id],
          encryptionFormat: 'box',
        },
        cb,
      );
    }),
    pull.asyncMap((_prevMsg, cb) => {
      ssb.db.create(
        {
          keys: lucyKeys,
          content: {
            type: 'post',
            text: 'Third secret message',
            root: rootKey,
          },
          recps: [ssb.id],
          encryptionFormat: 'box',
        },
        cb,
      );
    }),
    pull.map(() => ssb.threads.thread({ root: rootKey, private: true })),
    pull.flatten(),

    pull.collect((err, threads) => {
      t.error(err, 'no error');
      t.equals(threads.length, 1, 'one secret thread arrived');
      const thread = threads[0];
      t.equals(thread.full, true, 'thread comes back full');
      t.equals(thread.messages.length, 3, 'thread has 3 messages');
      t.equals(thread.messages[0].value.content.text, 'Secret thread root');
      t.equals(thread.messages[1].value.content.text, 'Second secret message');
      t.equals(thread.messages[2].value.content.text, 'Third secret message');
      ssb.close(t.end);
    }),
  );
});

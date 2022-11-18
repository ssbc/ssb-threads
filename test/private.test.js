const test = require('tape');
const pull = require('pull-stream');
const ssbKeys = require('ssb-keys');
const pullAsync = require('pull-async');
const Testbot = require('./testbot');

const lucyKeys = ssbKeys.generate(null, 'lucy');

test('threads.private gives a simple well-formed thread', (t) => {
  const ssb = Testbot({
    keys: lucyKeys,
  });

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
    pull.map(() => ssb.threads.private({})),
    pull.flatten(),

    pull.collect((err, sthreads) => {
      t.error(err);
      t.equals(sthreads.length, 1, 'only one secret thread');
      const thread = sthreads[0];
      t.equals(thread.full, true, 'thread comes back full');
      t.equals(thread.messages.length, 3, 'thread has 3 messages');

      const msgs = thread.messages;
      const rootKey = msgs[0].key;
      t.equals(msgs[0].value.content.root, undefined, '1st message is root');
      t.equals(msgs[0].value.content.text, 'Secret thread root');

      t.equals(msgs[1].value.content.root, rootKey, '2nd message is not root');
      t.equals(msgs[1].value.content.text, 'Second secret message');

      t.equals(msgs[2].value.content.root, rootKey, '3rd message is not root');
      t.equals(msgs[2].value.content.text, 'Third secret message');

      pull(
        ssb.threads.public({}),
        pull.collect((err, threads) => {
          t.error(err);
          t.equals(threads.length, 0, 'there are no public threads');
          ssb.close(t.end);
        }),
      );
    }),
  );
});

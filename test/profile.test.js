const test = require('tape');
const pull = require('pull-stream');
const ssbKeys = require('ssb-keys');
const pullAsync = require('pull-async');
const Testbot = require('./testbot');
const wait = require('./wait');

const lucyKeys = ssbKeys.generate(null, 'lucy');
const maryKeys = ssbKeys.generate(null, 'mary');

test('threads.profile gives threads for lucy not mary', (t) => {
  const ssb = Testbot({ keys: lucyKeys });

  let msg1;
  pull(
    pullAsync((cb) => {
      ssb.db.create(
        {
          keys: lucyKeys,
          content: { type: 'post', text: 'Root from lucy' },
        },
        wait(cb),
      );
    }),
    pull.asyncMap((msg, cb) => {
      msg1 = msg;
      ssb.db.create(
        {
          keys: maryKeys,
          content: { type: 'post', text: 'Root from mary' },
        },
        wait(cb),
      );
    }),
    pull.asyncMap((_, cb) => {
      ssb.db.create(
        {
          keys: lucyKeys,
          content: { type: 'post', text: 'Reply from lucy', root: msg1.key },
        },
        wait(cb),
      );
    }),
    pull.map(() => ssb.threads.profile({ id: lucyKeys.id })),
    pull.flatten(),

    pull.collect((err, threads) => {
      t.error(err);
      t.equals(threads.length, 1, 'only one thread');
      const thread = threads[0];
      t.equals(thread.full, true, 'thread comes back full');
      t.equals(thread.messages.length, 2, 'thread has 2 messages');

      const msgs = thread.messages;
      const rootKey = msgs[0].key;
      t.equals(msgs[0].value.content.root, undefined, '1st message is root');
      t.equals(msgs[0].value.content.text, 'Root from lucy');

      t.equals(msgs[1].value.content.root, rootKey, '2nd message is not root');
      t.equals(msgs[1].value.content.text, 'Reply from lucy');

      ssb.close(t.end);
    }),
  );
});

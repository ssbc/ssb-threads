const test = require('tape');
const pull = require('pull-stream');
const ssbKeys = require('ssb-keys');
const pullAsync = require('pull-async');
const Testbot = require('./testbot');
const wait = require('./wait');

const lucyKeys = ssbKeys.generate(null, 'lucy');
const maryKeys = ssbKeys.generate(null, 'mary');
const noraKeys = ssbKeys.generate(null, 'nora');

test('threads.profile gives threads for lucy not mary', (t) => {
  const ssb = Testbot({ keys: lucyKeys });

  pull(
    // ✓ Thread
    //   - started: Lucy
    //   - replied: Lucy
    pullAsync((cb) => {
      ssb.db.create(
        {
          keys: lucyKeys,
          content: { type: 'post', text: 'Root from lucy' },
        },
        wait(cb),
      );
    }),
    pull.asyncMap((lucyMsg, cb) => {
      ssb.db.create(
        {
          keys: lucyKeys,
          content: { type: 'post', text: 'Reply from lucy (1)', root: lucyMsg.key },
        },
        wait(cb),
      );
    }),
    // ✓ Thread
    //   - started: Mary
    //   - replied: Lucy
    pull.asyncMap((_, cb) => {
      ssb.db.create(
        {
          keys: maryKeys,
          content: { type: 'post', text: 'Root from mary' },
        },
        wait(cb),
      );
    }),
    pull.asyncMap((maryMsg, cb) => {
      ssb.db.create(
        {
          keys: lucyKeys,
          content: { type: 'post', text: 'Reply from lucy (2)', root: maryMsg.key },
        },
        wait(cb),
      );
    }),
    // ✗ Thread
    //   - started: Nora
    //   - replied: null
    pull.asyncMap((maryMsg, cb) => {
      ssb.db.create(
        {
          keys: noraKeys,
          content: { type: 'post', text: 'Root from nora' },
        },
        wait(cb),
      );
    }),
    pull.map(() => ssb.threads.profile({ id: lucyKeys.id })),
    pull.flatten(),

    pull.collect((err, threads) => {
      t.error(err);
      t.equals(threads.length, 2, 'two threads');

      // Mary's thred
      t.equals(threads[0].full, true, 'thread comes back full');
      t.equals(threads[0].messages.length, 2, 'thread has 2 messages');

      t.deepEquals(
        threads[0].messages.map(m => m.value.content),
        [
          { type: 'post', text: 'Root from mary' },
          { type: 'post', text: 'Reply from lucy (2)', root: threads[0].messages[0].key },
        ]
      )
      
      // Lucy's thread
      t.equals(threads[1].full, true, 'thread comes back full');
      t.equals(threads[1].messages.length, 2, 'thread has 2 messages');

      t.deepEquals(
        threads[1].messages.map(m => m.value.content),
        [
          { type: 'post', text: 'Root from lucy' },
          { type: 'post', text: 'Reply from lucy (1)', root: threads[1].messages[0].key },
        ]
      )

      t.comment('> opts.initiatedOnly') 
      pull(
        ssb.threads.profile({ id: lucyKeys.id, initiatedOnly: true }),
        pull.collect((err, threads) => {
          t.error(err);
          t.equals(threads.length, 1, '1 thread');

          // Lucy's thread
          t.equals(threads[0].full, true, 'thread comes back full');
          t.equals(threads[0].messages.length, 2, 'thread has 2 messages');

          t.deepEquals(
            threads[0].messages.map(m => m.value.content),
            [
              { type: 'post', text: 'Root from lucy' },
              { type: 'post', text: 'Reply from lucy (1)', root: threads[0].messages[0].key },
            ]
          )

          ssb.close(t.end);
        })
      )
    }),
  );
});

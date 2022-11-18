const test = require('tape');
const pull = require('pull-stream');
const ssbKeys = require('ssb-keys');
const pullAsync = require('pull-async');
const Testbot = require('./testbot');
const wait = require('./wait');

const lucyKeys = ssbKeys.generate(null, 'lucy');
const maryKeys = ssbKeys.generate(null, 'mary');
const aliceKeys = ssbKeys.generate(null, 'alice');

test('threads.publicSummary gives a simple well-formed summary', (t) => {
  const ssb = Testbot({ keys: lucyKeys });

  pull(
    pullAsync((cb) => {
      ssb.db.publish({ type: 'post', text: 'Thread root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      ssb.db.publish(
        { type: 'post', text: 'Second message', root: rootMsg.key },
        wait(cb, 800),
      );
    }),
    pull.asyncMap((prevMsg, cb) => {
      const rootKey = prevMsg.value.content.root;
      ssb.db.publish(
        { type: 'post', text: 'Third message', root: rootKey },
        wait(cb, 800),
      );
    }),
    pull.map(() => ssb.threads.publicSummary({})),
    pull.flatten(),

    pull.collect((err, summaries) => {
      t.error(err);
      t.equals(summaries.length, 1, 'only one summary');
      const summary = summaries[0];
      t.equals(summary.replyCount, 2, 'summary counts 2 replies');
      t.true(
        summary.timestamp > summary.root.timestamp,
        'summary timestamp greater than root timestamp',
      );
      t.equals(
        summary.root.value.content.root,
        undefined,
        'root message is root',
      );
      t.equals(summary.root.value.content.text, 'Thread root');

      ssb.close(t.end);
    }),
  );
});

test('threads.publicSummary can handle hundreds of threads', (t) => {
  const ssb = Testbot({ keys: lucyKeys });

  const TOTAL = 1000;

  const roots = [];
  pull(
    pull.count(TOTAL),
    pull.asyncMap((x, cb) => {
      if (roots.length && Math.random() < 0.7) {
        const rootMsgKey = roots[Math.floor(Math.random() * roots.length)];
        ssb.db.publish({ type: 'post', text: 'reply', root: rootMsgKey }, cb);
      } else {
        ssb.db.publish({ type: 'post', text: 'root' }, cb);
      }
    }),
    pull.through((msg) => {
      if (!msg.value.content.root) roots.push(msg.key);
    }),
    pull.drain(
      () => {},
      () => {
        pull(
          ssb.threads.publicSummary({}),
          pull.collect((err, threads) => {
            t.error(err);
            t.pass(`there are ${threads.length} threads`);
            t.true(threads.length > TOTAL * 0.2, 'many threads');
            ssb.close(t.end);
          }),
        );
      },
    ),
  );
});

test('threads.publicSummary respects following opt', (t) => {
  const ssb = Testbot({
    keys: lucyKeys,
  });

  pull(
    pullAsync((cb) => {
      ssb.db.publish(
        { type: 'contact', contact: maryKeys.id, following: true },
        cb,
      );
    }),
    pull.asyncMap((_, cb) => {
      ssb.db.create(
        {
          keys: maryKeys,
          content: { type: 'post', text: 'Root post from Mary' },
        },
        cb,
      );
    }),
    pull.asyncMap((maryRoot, cb) => {
      ssb.db.create(
        {
          keys: aliceKeys,
          content: {
            type: 'post',
            text: 'Alice reply to Mary root',
            root: maryRoot.key,
          },
        },
        cb,
      );
    }),
    pull.asyncMap((_, cb) => {
      ssb.db.create(
        {
          keys: aliceKeys,
          content: { type: 'post', text: 'Root post from Alice' },
        },
        cb,
      );
    }),
    pull.map(() => ssb.threads.publicSummary({ following: true })),
    pull.flatten(),

    pull.collect((err, summaries) => {
      t.error(err);
      t.equals(summaries.length, 2);

      const onlyFollowingSummaries = summaries.every(
        (s) => s.root.value.author !== aliceKeys.id,
      );

      t.ok(
        onlyFollowingSummaries,
        'only summaries for threads created by following returned',
      );

      const contactSummary = summaries.find(
        (s) => s.root.value.content.type === 'contact',
      );
      const marySummary = summaries.find(
        (s) => s.root.value.author === maryKeys.id,
      );

      t.equals(contactSummary.replyCount, 0);

      t.equals(
        marySummary.replyCount,
        1,
        'Replies to threads from non-following still accounted for',
      );

      ssb.close(t.end);
    }),
  );
});

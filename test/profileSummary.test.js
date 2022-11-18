const test = require('tape');
const pull = require('pull-stream');
const ssbKeys = require('ssb-keys');
const pullAsync = require('pull-async');
const Testbot = require('./testbot');
const wait = require('./wait');

const lucyKeys = ssbKeys.generate(null, 'lucy');
const maryKeys = ssbKeys.generate(null, 'mary');

test('threads.profileSummary gives threads for lucy not mary', (t) => {
  const ssb = Testbot({ keys: lucyKeys });

  let msg1;
  pull(
    pullAsync((cb) => {
      ssb.db.create(
        { keys: lucyKeys, content: { type: 'post', text: 'Root from lucy' } },
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
    pull.map(() => ssb.threads.profileSummary({ id: lucyKeys.id })),
    pull.flatten(),

    pull.collect((err, summaries) => {
      t.error(err);
      t.equals(summaries.length, 1, 'only one summary');
      const summary = summaries[0];
      t.equals(summary.replyCount, 1, 'summary counts 1 reply');
      t.equals(
        summary.root.value.content.root,
        undefined,
        'root message is root',
      );
      t.equals(summary.root.value.content.text, 'Root from lucy');

      ssb.close(t.end);
    }),
  );
});

test('threads.profileSummary gives summary with correct timestamp', (t) => {
  const ssb = Testbot({ keys: lucyKeys });

  pull(
    pullAsync((cb) => {
      ssb.db.publish({ type: 'post', text: 'Root from lucy' }, wait(cb));
    }),
    pull.asyncMap((rootMsg, cb) => {
      ssb.db.publish(
        { type: 'post', text: 'Reply from lucy', root: rootMsg.key },
        wait(cb),
      );
    }),
    pull.map(() => ssb.threads.profileSummary({ id: lucyKeys.id })),
    pull.flatten(),

    pull.collect((err, summaries) => {
      t.error(err);
      t.equals(summaries.length, 1, 'only one summary');
      const summary = summaries[0];
      t.equals(summary.replyCount, 1, 'summary counts 1 reply');
      t.true(
        summary.timestamp > summary.root.timestamp,
        'summary timestamp greater than root timestamp',
      );
      t.equals(
        summary.root.value.content.root,
        undefined,
        'root message is root',
      );
      t.equals(summary.root.value.content.text, 'Root from lucy');

      ssb.close(t.end);
    }),
  );
});

const test = require('tape');
const pull = require('pull-stream');
const ssbKeys = require('ssb-keys');
const pullAsync = require('pull-async');
const Testbot = require('./testbot');
const wait = require('./wait');

const lucyKeys = ssbKeys.generate(null, 'lucy');

test('threads.hashtagCount understands msg.value.content.channel', (t) => {
  const ssb = Testbot({ keys: lucyKeys });

  pull(
    pullAsync((cb) => {
      ssb.db.create(
        {
          keys: lucyKeys,
          content: { type: 'post', text: 'My favorite animals (thread 1)' },
        },
        wait(cb, 100),
      );
    }),
    pull.asyncMap((rootMsg, cb) => {
      ssb.db.create(
        {
          keys: lucyKeys,
          content: {
            type: 'post',
            text: 'wombat (reply to thread 1)',
            channel: 'animals',
            root: rootMsg.key,
          },
        },
        wait(cb, 100),
      );
    }),
    pull.asyncMap((_, cb) => {
      ssb.db.create(
        {
          keys: lucyKeys,
          content: {
            type: 'post',
            text: 'My favorite animal is the wombat (thread 2)',
            channel: 'animals',
          },
        },
        wait(cb, 100),
      );
    }),
    pull.drain(null, (err) => {
      t.error(err);

      ssb.threads.hashtagCount({ hashtag: 'animals' }, (err2, count) => {
        t.error(err2);
        t.isEqual(count, 2);
        ssb.close(t.end);
      });
    }),
  );
});

test('threads.hashtagCount understands msg.value.content.mentions', (t) => {
  const ssb = Testbot({ keys: lucyKeys });

  pull(
    pullAsync((cb) => {
      ssb.db.create(
        {
          keys: lucyKeys,
          content: { type: 'post', text: 'My favorite animals (thread 1)' },
        },
        wait(cb, 100),
      );
    }),
    pull.asyncMap((rootMsg, cb) => {
      ssb.db.create(
        {
          keys: lucyKeys,
          content: {
            type: 'post',
            text: 'wombat (reply to thread 1)',
            mentions: [{ link: '#animals' }],
            root: rootMsg.key,
          },
        },
        wait(cb, 100),
      );
    }),
    pull.asyncMap((_, cb) => {
      ssb.db.create(
        {
          keys: lucyKeys,
          content: {
            type: 'post',
            text: 'My favorite animal is the wombat (thread 2)',
            mentions: [{ link: '#animals' }],
          },
        },
        wait(cb, 100),
      );
    }),
    pull.drain(null, (err) => {
      t.error(err);

      ssb.threads.hashtagCount({ hashtag: 'animals' }, (err2, count) => {
        t.error(err2);
        t.isEqual(count, 2);
        ssb.close(t.end);
      });
    }),
  );
});

test('threads.hashtagCount input is case-insensitive', (t) => {
  const ssb = Testbot({ keys: lucyKeys });

  pull(
    pullAsync((cb) => {
      ssb.db.create(
        {
          keys: lucyKeys,
          content: {
            type: 'post',
            text: 'My favorite animal is the wombat',
            mentions: [{ link: '#animals' }],
          },
        },
        wait(cb, 100),
      );
    }),
    pull.drain(null, (err) => {
      t.error(err);

      ssb.threads.hashtagCount({ hashtag: 'ANIMALS' }, (err2, count) => {
        t.error(err2);
        t.isEqual(count, 1);
        ssb.close(t.end);
      });
    }),
  );
});

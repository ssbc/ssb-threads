const test = require('tape');
const pull = require('pull-stream');
const pullAsync = require('pull-async');
const ssbKeys = require('ssb-keys');
const p = require('util').promisify;
const Testbot = require('./testbot');
const wait = require('./wait');

const andrewKeys = ssbKeys.generate(null, 'andrew');
const brianKeys = ssbKeys.generate(null, 'brian');

test('threads.recentHashtags errors on bad limit option', (t) => {
  const ssb = Testbot({ keys: andrewKeys });

  ssb.threads.recentHashtags({ limit: 0 }, (err) => {
    t.ok(err);

    ssb.threads.recentHashtags({ limit: -1 }, (err2) => {
      t.ok(err2);
      ssb.close(t.end);
    });
  });
});

test('threads.recentHashtags returns empty result when no messages with hashtags exist', (t) => {
  const ssb = Testbot({ keys: andrewKeys });

  pull(
    pullAsync((cb) => {
      ssb.db.create(
        {
          keys: andrewKeys,
          content: {
            type: 'post',
            text: 'My favorite animals (thread 1)',
          },
        },
        wait(cb, 100),
      );
    }),
    pull.asyncMap((rootMsg, cb) => {
      ssb.db.create(
        {
          keys: andrewKeys,
          content: {
            type: 'post',
            text: 'I like wombats (reply to thread 1)',
            root: rootMsg,
          },
        },
        wait(cb, 100),
      );
    }),
    pull.asyncMap((_, cb) => {
      ssb.db.create(
        {
          keys: brianKeys,
          content: {
            type: 'post',
            text: 'My favorite animal is the beaver (thread 2)',
          },
        },
        wait(cb, 100),
      );
    }),
    pull.drain(null, (err) => {
      t.error(err);

      ssb.threads.recentHashtags({ limit: 10 }, (err2, hashtags) => {
        t.error(err2);
        t.deepEquals(hashtags, []);
        ssb.close(t.end);
      });
    }),
  );
});

test('threads.recentHashtags basic case works', (t) => {
  const ssb = Testbot({ keys: andrewKeys });

  pull(
    pullAsync((cb) => {
      ssb.db.create(
        {
          keys: andrewKeys,
          content: {
            type: 'post',
            text: 'My favorite animals (thread 1)',
            channel: 'animals',
          },
        },
        wait(cb, 100),
      );
    }),
    pull.asyncMap((rootMsg, cb) => {
      ssb.db.create(
        {
          keys: andrewKeys,
          content: {
            type: 'post',
            text: 'I like #wombats (reply to thread 1)',
            mentions: [{ link: '#wombats' }],
            root: rootMsg,
          },
        },
        wait(cb, 100),
      );
    }),
    pull.asyncMap((_, cb) => {
      ssb.db.create(
        {
          keys: brianKeys,
          content: {
            type: 'post',
            text: 'My favorite animal is the #beaver (thread 2)',
            mentions: [{ link: '#beaver' }],
          },
        },
        wait(cb, 100),
      );
    }),
    pull.drain(null, (err) => {
      t.error(err);

      ssb.threads.recentHashtags({ limit: 10 }, (err2, hashtags) => {
        t.error(err2);
        t.deepEquals(hashtags, ['beaver', 'wombats', 'animals']);
        ssb.close(t.end);
      });
    }),
  );
});

test('threads.recentHashtags respects limit opt', (t) => {
  const ssb = Testbot({ keys: andrewKeys });

  pull(
    pullAsync((cb) => {
      ssb.db.create(
        {
          keys: andrewKeys,
          content: {
            type: 'post',
            text: 'My favorite animals (thread 1)',
            channel: 'animals',
          },
        },
        wait(cb, 100),
      );
    }),
    pull.asyncMap((rootMsg, cb) => {
      ssb.db.create(
        {
          keys: andrewKeys,
          content: {
            type: 'post',
            text: 'I like #wombats (reply to thread 1)',
            mentions: [{ link: '#wombats' }],
            root: rootMsg,
          },
        },
        wait(cb, 100),
      );
    }),
    pull.asyncMap((_, cb) => {
      ssb.db.create(
        {
          keys: brianKeys,
          content: {
            type: 'post',
            text: 'My favorite animal is the #beaver (thread 2)',
            mentions: [{ link: '#beaver' }],
          },
        },
        wait(cb, 100),
      );
    }),
    pull.drain(null, (err) => {
      t.error(err);

      ssb.threads.recentHashtags({ limit: 2 }, (err2, hashtags) => {
        t.error(err2);
        t.deepEquals(hashtags, ['beaver', 'wombats']);
        ssb.close(t.end);
      });
    }),
  );
});

test('threads.recentHashtags respects preserveCase opt', (t) => {
  const ssb = Testbot({ keys: andrewKeys });

  pull(
    pullAsync((cb) => {
      ssb.db.create(
        {
          keys: andrewKeys,
          content: {
            type: 'post',
            text: 'My favorite animals (thread 1)',
            channel: 'animals',
          },
        },
        wait(cb, 100),
      );
    }),
    pull.asyncMap((rootMsg, cb) => {
      ssb.db.create(
        {
          keys: andrewKeys,
          content: {
            type: 'post',
            text: 'I like #wombats (reply to thread 1)',
            mentions: [{ link: '#wombats' }],
            root: rootMsg,
          },
        },
        wait(cb, 100),
      );
    }),
    pull.asyncMap((_, cb) => {
      ssb.db.create(
        {
          keys: brianKeys,
          content: {
            type: 'post',
            text: 'My favorite animal is the #BlueBeaver (thread 2)',
            mentions: [{ link: '#BlueBeaver' }],
          },
        },
        wait(cb, 100),
      );
    }),
    pull.drain(null, (err) => {
      t.error(err);

      ssb.threads.recentHashtags(
        { limit: 1, preserveCase: false },
        (err2, hashtags) => {
          t.error(err2);
          t.deepEquals(hashtags, ['bluebeaver']);

          ssb.threads.recentHashtags(
            { limit: 1, preserveCase: true },
            (err3, hashtags2) => {
              t.error(err3);
              t.deepEquals(hashtags2, ['BlueBeaver']);
              ssb.close(t.end);
            },
          );
        },
      );
    }),
  );
});

test('threads.recentHashtags handles messages with many mentions links', (t) => {
  const ssb = Testbot({ keys: andrewKeys });

  pull(
    pullAsync((cb) => {
      ssb.db.create(
        {
          keys: andrewKeys,
          content: {
            type: 'post',
            text: '#Animals I like include #wombats and #beavers',
            mentions: [
              { link: '#animals' },
              { link: '#wombats' },
              { link: '#beavers' },
            ],
          },
        },
        cb,
      );
    }),
    pull.asyncMap((_, cb) => {
      ssb.db.create(
        {
          keys: andrewKeys,
          content: {
            type: 'post',
            text: '#p4p is 2x cooler than #p2p',
            mentions: [{ link: '#p4p' }, { link: '#p2p' }],
          },
        },
        cb,
      );
    }),
    pull.drain(null, (err) => {
      t.error(err);

      ssb.threads.recentHashtags(
        { limit: 10, preserveCase: true },
        (err2, hashtags) => {
          t.error(err2);
          t.deepEquals(hashtags, [
            'p4p',
            'p2p',
            'animals',
            'wombats',
            'beavers',
          ]);
          ssb.close(t.end);
        },
      );
    }),
  );
});

test('threads.recentHashtags returns most recently seen variation when preserveCase opt is true', (t) => {
  const ssb = Testbot({ keys: andrewKeys });

  pull(
    pullAsync((cb) => {
      ssb.db.create(
        {
          keys: andrewKeys,
          content: {
            type: 'post',
            text: 'My favorite animals (thread 1)',
            channel: 'animals',
          },
        },
        wait(cb, 100),
      );
    }),
    pull.asyncMap((rootMsg, cb) => {
      ssb.db.create(
        {
          keys: brianKeys,
          content: {
            type: 'post',
            text: '#Animals I like include wombats (reply to thread 1)',
            mentions: [{ link: '#Animals' }],
            root: rootMsg,
          },
        },
        wait(cb, 100),
      );
    }),
    pull.drain(null, (err) => {
      t.error(err);

      ssb.threads.recentHashtags(
        { limit: 10, preserveCase: true },
        (err2, hashtags) => {
          t.error(err2);
          t.deepEquals(hashtags, ['Animals']);
          ssb.close(t.end);
        },
      );
    }),
  );
});

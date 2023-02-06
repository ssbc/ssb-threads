const test = require('tape');
const pull = require('pull-stream');
const ssbKeys = require('ssb-keys');
const pullAsync = require('pull-async');
const Testbot = require('./testbot');
const wait = require('./wait');

const andrewKeys = ssbKeys.generate(null, 'andrew');

test('threads.hashtagsMatching handles invalid opts.query', (t) => {
  const ssb = Testbot({ keys: andrewKeys });

  ssb.threads.hashtagsMatching({ query: '' }, (err, matches) => {
    t.ok(err, 'throws error');
    ssb.close(t.end);
  });
});

test('threads.hashtagsMatching handles invalid opts.limit', (t) => {
  const ssb = Testbot({ keys: andrewKeys });

  ssb.threads.hashtagsMatching({ query: 'a', limit: -1 }, (err, matches) => {
    t.ok(err, 'throws error');
    ssb.close(t.end);
  });
});

test('threads.hashtagsMatching respects opts.query', (t) => {
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
    pull.asyncMap((_, cb) => {
      ssb.db.create(
        {
          keys: andrewKeys,
          content: {
            type: 'post',
            text: 'My favorite animal is the beaver (thread 2)',
            channel: 'animals',
          },
        },
        wait(cb, 100),
      );
    }),
    pull.drain(null, (err) => {
      t.error(err);

      ssb.threads.hashtagsMatching({ query: 'a' }, (err2, matches) => {
        t.error(err2);
        t.deepEquals(matches, [['animals', 2]]);
        ssb.close(t.end);
      });
    }),
  );
});

test('threads.hashtagsMatching returns results sorted by number of occurrences (highest to lowest)', (t) => {
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
            text: 'My favorite animal is the #antelope (reply to thread 1)',
            mentions: [{ link: '#antelope' }],
            root: rootMsg,
          },
        },
        wait(cb, 100),
      );
    }),
    pull.asyncMap((_, cb) => {
      ssb.db.create(
        {
          keys: andrewKeys,
          content: {
            type: 'post',
            text: 'My favorite animal is the beaver (thread 2)',
            channel: 'animals',
          },
        },
        wait(cb, 100),
      );
    }),
    pull.drain(null, (err) => {
      t.error(err);

      ssb.threads.hashtagsMatching({ query: 'a' }, (err2, matches) => {
        t.error(err2);
        t.deepEquals(matches, [
          ['animals', 2],
          ['antelope', 1],
        ]);
        ssb.close(t.end);
      });
    }),
  );
});

test('threads.hashtagsMatching filters out lexigraphically close (but non-matching) hashtags', (t) => {
  const ssb = Testbot({ keys: andrewKeys });

  pull(
    pullAsync((cb) => {
      ssb.db.create(
        {
          keys: andrewKeys,
          content: {
            type: 'post',
            text: 'p2p',
            channel: 'p2p',
          },
        },
        wait(cb, 100),
      );
    }),
    pull.asyncMap((_, cb) => {
      ssb.db.create(
        {
          keys: andrewKeys,
          content: {
            type: 'post',
            text: '#p4p',
            mentions: [{ link: '#p4p' }],
          },
        },
        wait(cb, 100),
      );
    }),
    pull.drain(null, (err) => {
      t.error(err);

      ssb.threads.hashtagsMatching({ query: 'p4' }, (err2, matches) => {
        t.error(err2);
        t.deepEquals(matches, [['p4p', 1]]);
        ssb.close(t.end);
      });
    }),
  );
});

test('threads.hashtagsMatching respects default limit of 10 results', (t) => {
  const ssb = Testbot({ keys: andrewKeys });

  function createAnimalsPost(n) {
    function dbCreate(cb) {
      return ssb.db.create(
        {
          keys: andrewKeys,
          content: {
            type: 'post',
            text: `${n} #animals`,
            mentions: [{ link: `#animals${n}` }],
          },
        },
        wait(cb, 100),
      );
    }

    return n === 1
      ? pullAsync(dbCreate)
      : pull.asyncMap((_, cb) => dbCreate(cb));
  }

  pull(
    createAnimalsPost(1),
    createAnimalsPost(2),
    createAnimalsPost(3),
    createAnimalsPost(4),
    createAnimalsPost(5),
    createAnimalsPost(6),
    createAnimalsPost(7),
    createAnimalsPost(8),
    createAnimalsPost(9),
    createAnimalsPost(10),
    createAnimalsPost(11),
    pull.drain(null, (err) => {
      t.error(err);

      ssb.threads.hashtagsMatching({ query: 'a' }, (err2, matches) => {
        t.error(err2);
        t.equals(matches.length, 10);
        ssb.close(t.end);
      });
    }),
  );
});

test('threads.hashtagsMatching respects opts.limit when provided', (t) => {
  const ssb = Testbot({ keys: andrewKeys });

  pull(
    pullAsync((cb) => {
      ssb.db.create(
        {
          keys: andrewKeys,
          content: {
            type: 'post',
            text: 'My favorite #animals (thread 1)',
            channel: 'animals',
          },
        },
        wait(cb, 100),
      );
    }),
    pull.asyncMap((_, cb) => {
      ssb.db.create(
        {
          keys: andrewKeys,
          content: {
            type: 'post',
            text: 'My favorite animal is the #antelope (thread 2)',
            mentions: [{ link: '#antelope' }],
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
            text: 'I also like the #antelope (reply to thread 2)',
            mentions: [{ link: '#antelope' }],
            root: rootMsg.key,
          },
        },
        wait(cb, 100),
      );
    }),
    pull.drain(null, (err) => {
      t.error(err);

      ssb.threads.hashtagsMatching(
        { query: 'a', limit: 1 },
        (err2, matches) => {
          t.error(err2);
          t.deepEquals(matches, [['antelope', 2]]);
          ssb.close(t.end);
        },
      );
    }),
  );
});

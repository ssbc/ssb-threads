const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('tape');
const pull = require('pull-stream');
const ssbKeys = require('ssb-keys');
const pullAsync = require('pull-async');
const cat = require('pull-cat');

const CreateTestSbot = require('ssb-server/index')
  .use(require('ssb-backlinks'))
  .use(require('ssb-private'))
  .use(require('./lib/index'));

const lucyKeys = ssbKeys.generate();
const maryKeys = ssbKeys.generate();

function wait(cb) {
  return (err, data) => {
    setTimeout(() => cb(err, data), 100);
  };
}

test('threads.public gives a simple well-formed thread', t => {
  const myTestSbot = CreateTestSbot({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test1',
    keys: lucyKeys,
  });

  const lucy = myTestSbot.createFeed(lucyKeys);

  pull(
    pullAsync(cb => {
      lucy.add({ type: 'post', text: 'Thread root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      lucy.add({ type: 'post', text: 'Second message', root: rootMsg.key }, cb);
    }),
    pull.asyncMap((prevMsg, cb) => {
      const rootKey = prevMsg.value.content.root;
      lucy.add({ type: 'post', text: 'Third message', root: rootKey }, cb);
    }),
    pull.map(() => myTestSbot.threads.public({})),
    pull.flatten(),

    pull.collect((err, threads) => {
      t.error(err);
      t.equals(threads.length, 1, 'only one thread');
      const thread = threads[0];
      t.equals(thread.full, true, 'thread comes back full');
      t.equals(thread.messages.length, 3, 'thread has 3 messages');

      const msgs = thread.messages;
      const rootKey = msgs[0].key;
      t.equals(msgs[0].value.content.root, undefined, '1st message is root');
      t.equals(msgs[0].value.content.text, 'Thread root');

      t.equals(msgs[1].value.content.root, rootKey, '2nd message is not root');
      t.equals(msgs[1].value.content.text, 'Second message');

      t.equals(msgs[2].value.content.root, rootKey, '3rd message is not root');
      t.equals(msgs[2].value.content.text, 'Third message');
      myTestSbot.close();
      t.end();
    }),
  );
});

test('threads.public can be called twice consecutively (to use cache)', t => {
  const myTestSbot = CreateTestSbot({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test1',
    keys: lucyKeys,
  });

  const lucy = myTestSbot.createFeed(lucyKeys);

  pull(
    pullAsync(cb => {
      lucy.add({ type: 'post', text: 'Thread root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      lucy.add({ type: 'post', text: 'Second message', root: rootMsg.key }, cb);
    }),
    pull.asyncMap((prevMsg, cb) => {
      const rootKey = prevMsg.value.content.root;
      lucy.add({ type: 'post', text: 'Third message', root: rootKey }, cb);
    }),
    pull.map(() =>
      cat([myTestSbot.threads.public({}), myTestSbot.threads.public({})]),
    ),
    pull.flatten(),

    pull.collect((err, threads) => {
      t.error(err);
      t.equals(threads.length, 2, 'two threads');

      const thread1 = threads[0];
      const msgs1 = thread1.messages;
      const root1 = msgs1[0].key;

      t.equals(thread1.full, true, 'thread 1 comes back full');
      t.equals(thread1.messages.length, 3, 'thread 1 has 3 messages');

      t.equals(msgs1[0].value.content.root, undefined, '1st message is root');
      t.equals(msgs1[0].value.content.text, 'Thread root');

      t.equals(msgs1[1].value.content.root, root1, '2nd message is not root');
      t.equals(msgs1[1].value.content.text, 'Second message');

      t.equals(msgs1[2].value.content.root, root1, '3rd message is not root');
      t.equals(msgs1[2].value.content.text, 'Third message');

      const thread2 = threads[1];
      const msgs2 = thread2.messages;
      const root2 = msgs2[0].key;

      t.equals(thread2.full, true, 'thread 2 comes back full');
      t.equals(thread2.messages.length, 3, 'thread 2 has 3 messages');
      t.equals(root2, root1, 'same root as before');

      t.equals(msgs2[0].value.content.root, undefined, '1st message is root');
      t.equals(msgs2[0].value.content.text, 'Thread root');

      t.equals(msgs2[1].value.content.root, root2, '2nd message is not root');
      t.equals(msgs2[1].value.content.text, 'Second message');

      t.equals(msgs2[2].value.content.root, root2, '3rd message is not root');
      t.equals(msgs2[2].value.content.text, 'Third message');
      myTestSbot.close();
      t.end();
    }),
  );
});

test('threads.public does not show any private threads', t => {
  const myTestSbot = CreateTestSbot({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test1',
    keys: lucyKeys,
  });

  const lucy = myTestSbot.createFeed(lucyKeys);

  pull(
    pullAsync(cb => {
      myTestSbot.private.publish(
        { type: 'post', text: 'Secret thread root' },
        [myTestSbot.id],
        cb,
      );
    }),
    pull.asyncMap((_, cb) => {
      lucy.add({ type: 'post', text: 'Thread root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      lucy.add({ type: 'post', text: 'Second message', root: rootMsg.key }, cb);
    }),
    pull.asyncMap((prevMsg, cb) => {
      const rootKey = prevMsg.value.content.root;
      lucy.add({ type: 'post', text: 'Third message', root: rootKey }, cb);
    }),
    pull.map(() => myTestSbot.threads.public({})),
    pull.flatten(),

    pull.collect((err, threads) => {
      t.error(err);
      t.equals(threads.length, 1, 'only one thread');
      const thread = threads[0];
      t.equals(thread.full, true, 'thread comes back full');
      t.equals(thread.messages.length, 3, 'thread has 3 messages');

      const msgs = thread.messages;
      const rootKey = msgs[0].key;
      t.equals(msgs[0].value.content.root, undefined, '1st message is root');
      t.equals(msgs[0].value.content.text, 'Thread root');

      t.equals(msgs[1].value.content.root, rootKey, '2nd message is not root');
      t.equals(msgs[1].value.content.text, 'Second message');

      t.equals(msgs[2].value.content.root, rootKey, '3rd message is not root');
      t.equals(msgs[2].value.content.text, 'Third message');
      myTestSbot.close();
      t.end();
    }),
  );
});

test('threads.public respects threadMaxSize opt', t => {
  const myTestSbot = CreateTestSbot({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test2',
    keys: lucyKeys,
  });

  const lucy = myTestSbot.createFeed(lucyKeys);

  pull(
    pullAsync(cb => {
      lucy.add({ type: 'post', text: 'Thread root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      lucy.add({ type: 'post', text: 'Second message', root: rootMsg.key }, cb);
    }),
    pull.asyncMap((prevMsg, cb) => {
      const rootKey = prevMsg.value.content.root;
      lucy.add({ type: 'post', text: 'Third message', root: rootKey }, cb);
    }),
    pull.map(() => myTestSbot.threads.public({ threadMaxSize: 2 })),
    pull.flatten(),

    pull.collect((err, threads) => {
      t.error(err);
      t.equals(threads.length, 1, 'only one thread');
      const thread = threads[0];
      t.equals(thread.full, false, 'thread comes back NOT full');
      t.equals(thread.messages.length, 2, 'thread has 2 messages');

      const msgs = thread.messages;
      const rootKey = msgs[0].key;
      t.equals(msgs[0].value.content.root, undefined, '1st message is root');
      t.equals(msgs[0].value.content.text, 'Thread root');

      t.equals(msgs[1].value.content.root, rootKey, '2nd message is not root');
      t.equals(msgs[1].value.content.text, 'Third message');
      myTestSbot.close();
      t.end();
    }),
  );
});

test('threads.public respects allowlist opt', t => {
  const myTestSbot = CreateTestSbot({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test3',
    keys: lucyKeys,
  });

  const lucy = myTestSbot.createFeed(lucyKeys);

  pull(
    pullAsync(cb => {
      lucy.add({ type: 'post', text: 'Thread root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      lucy.add(
        {
          type: 'vote',
          vote: {
            link: rootMsg.key,
            value: 1,
            expression: 'like',
          },
        },
        cb,
      );
    }),
    pull.asyncMap((_prevMsg, cb) => {
      lucy.add({ type: 'shout', text: 'AAAHHH' }, cb);
    }),
    pull.map(() => myTestSbot.threads.public({ allowlist: ['shout'] })),
    pull.flatten(),

    pull.collect((err, threads) => {
      t.error(err);
      t.equals(threads.length, 1, 'only one thread');
      const thread = threads[0];
      t.equals(thread.full, true, 'thread comes back full');
      t.equals(thread.messages.length, 1, 'thread has 1 messages');
      const msgs = thread.messages;
      t.equals(msgs[0].value.content.root, undefined, '1st message is root');
      t.equals(msgs[0].value.content.text, 'AAAHHH');
      myTestSbot.close();
      t.end();
    }),
  );
});

test('threads.public respects blocklist opt', t => {
  const myTestSbot = CreateTestSbot({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test4',
    keys: lucyKeys,
  });

  const lucy = myTestSbot.createFeed(lucyKeys);

  pull(
    pullAsync(cb => {
      lucy.add({ type: 'post', text: 'Thread root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      lucy.add(
        {
          type: 'vote',
          vote: {
            link: rootMsg.key,
            value: 1,
            expression: 'like',
          },
        },
        cb,
      );
    }),
    pull.asyncMap((_prevMsg, cb) => {
      lucy.add({ type: 'shout', text: 'AAAHHH' }, cb);
    }),
    pull.map(() => myTestSbot.threads.public({ blocklist: ['shout', 'vote'] })),
    pull.flatten(),

    pull.collect((err, threads) => {
      t.error(err);
      t.equals(threads.length, 1, 'only one thread');
      const thread = threads[0];
      t.equals(thread.full, true, 'thread comes back full');
      t.equals(thread.messages.length, 1, 'thread has 1 messages');
      const msgs = thread.messages;
      t.equals(msgs[0].value.content.root, undefined, '1st message is root');
      t.equals(msgs[0].value.content.text, 'Thread root');
      myTestSbot.close();
      t.end();
    }),
  );
});

test('threads.public gives multiple threads', t => {
  const myTestSbot = CreateTestSbot({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test5',
    keys: lucyKeys,
  });

  const lucy = myTestSbot.createFeed(lucyKeys);

  pull(
    pullAsync(cb => {
      lucy.add({ type: 'post', text: 'A: root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      lucy.add({ type: 'post', text: 'A: 2nd', root: rootMsg.key }, cb);
    }),
    pull.asyncMap((prevMsg, cb) => {
      const rootKey = prevMsg.value.content.root;
      lucy.add({ type: 'post', text: 'A: 3rd', root: rootKey }, cb);
    }),
    pull.asyncMap((_, cb) => {
      lucy.add({ type: 'post', text: 'B: root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      lucy.add({ type: 'post', text: 'B: 2nd', root: rootMsg.key }, cb);
    }),

    pull.map(() => myTestSbot.threads.public({ reverse: true })),
    pull.flatten(),

    pull.collect((err, threads) => {
      t.error(err);
      t.equals(threads.length, 2, 'has two threads');
      const [b, a] = threads;
      t.equals(b.full, true, '1st thread comes back full');
      t.equals(b.messages.length, 2, '1st thread has 2 messages');
      t.equals(b.messages[0].value.content.text, 'B: root', '1st thread is B');
      t.equals(a.full, true, '2nd thread comes back full');
      t.equals(a.messages.length, 3, '2nd thread has 3 messages');
      t.equals(a.messages[0].value.content.text, 'A: root', '2nd thread is A');
      myTestSbot.close();
      t.end();
    }),
  );
});

test('threads.public sorts threads by recency', t => {
  const myTestSbot = CreateTestSbot({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test5',
    keys: lucyKeys,
  });

  const lucy = myTestSbot.createFeed(lucyKeys);

  let rootAkey;
  pull(
    pullAsync(cb => {
      lucy.add({ type: 'post', text: 'A: root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      rootAkey = rootMsg.key;
      lucy.add({ type: 'post', text: 'A: 2nd', root: rootMsg.key }, cb);
    }),
    pull.asyncMap((_, cb) => {
      lucy.add({ type: 'post', text: 'B: root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      lucy.add({ type: 'post', text: 'B: 2nd', root: rootMsg.key }, cb);
    }),
    pull.asyncMap((_, cb) => {
      lucy.add({ type: 'post', text: 'A: 3rd', root: rootAkey }, cb);
    }),

    pull.map(() => myTestSbot.threads.public({ reverse: true })),
    pull.flatten(),

    pull.collect((err, threads) => {
      t.error(err);
      t.equals(threads.length, 2, 'has two threads');
      const [a, b] = threads;
      t.equals(a.full, true, '1st thread comes back full');
      t.equals(a.messages.length, 3, '1st thread has 3 messages');
      t.equals(a.messages[0].value.content.text, 'A: root', '1st thread is A');
      t.equals(b.full, true, '2nd thread comes back full');
      t.equals(b.messages.length, 2, '2nd thread has 2 messages');
      t.equals(b.messages[0].value.content.text, 'B: root', '2nd thread is B');
      myTestSbot.close();
      t.end();
    }),
  );
});

test('threads.publicSummary gives a simple well-formed summary', t => {
  const myTestSbot = CreateTestSbot({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test1',
    keys: lucyKeys,
  });

  const lucy = myTestSbot.createFeed(lucyKeys);

  pull(
    pullAsync(cb => {
      lucy.add({ type: 'post', text: 'Thread root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      lucy.add({ type: 'post', text: 'Second message', root: rootMsg.key }, cb);
    }),
    pull.asyncMap((prevMsg, cb) => {
      const rootKey = prevMsg.value.content.root;
      lucy.add({ type: 'post', text: 'Third message', root: rootKey }, cb);
    }),
    pull.map(() => myTestSbot.threads.publicSummary({})),
    pull.flatten(),

    pull.collect((err, summaries) => {
      t.error(err);
      t.equals(summaries.length, 1, 'only one summary');
      const summary = summaries[0];
      t.equals(summary.replyCount, 2, 'summary counts 2 replies');
      t.equals(summary.root.value.content.root, undefined, 'root message is root');
      t.equals(summary.root.value.content.text, 'Thread root');

      myTestSbot.close();
      t.end();
    }),
  );
});


test('threads.publicUpdates notifies of new thread or new msg', t => {
  const myTestSbot = CreateTestSbot({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test6',
    keys: lucyKeys,
  });

  const lucy = myTestSbot.createFeed(lucyKeys);
  const mary = myTestSbot.createFeed(maryKeys);

  let updates = 0;

  pull(
    myTestSbot.threads.publicUpdates({}),
    pull.drain(() => {
      updates++;
    }),
  );

  pull(
    pullAsync(cb => {
      lucy.add({ type: 'post', text: 'A: root' }, wait(cb));
    }),
    pull.asyncMap((rootMsg, cb) => {
      t.equals(updates, 0);
      mary.add({ type: 'post', text: 'A: 2nd', root: rootMsg.key }, wait(cb));
    }),
    pull.asyncMap((_, cb) => {
      t.equals(updates, 1);
      mary.add({ type: 'post', text: 'B: root' }, wait(cb));
    }),
    pull.asyncMap((rootMsg, cb) => {
      t.equals(updates, 2);
      lucy.add({ type: 'post', text: 'B: 2nd', root: rootMsg.key }, wait(cb));
    }),

    pull.drain(() => {
      t.equals(updates, 2);
      myTestSbot.close();
      t.end();
    }),
  );
});

test('threads.profile gives threads for lucy not mary', t => {
  const myTestSbot = CreateTestSbot({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test1',
    keys: lucyKeys,
  });

  const lucy = myTestSbot.createFeed(lucyKeys);
  const mary = myTestSbot.createFeed(maryKeys);
  let rootId;

  pull(
    pullAsync(cb => {
      lucy.add({ type: 'post', text: 'Root from lucy' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      rootId = rootMsg.key;
      mary.add({ type: 'post', text: 'Root from mary' }, cb);
    }),
    pull.asyncMap((_, cb) => {
      lucy.add({ type: 'post', text: 'Reply from lucy', root: rootId }, cb);
    }),
    pull.map(() => myTestSbot.threads.profile({ id: lucy.id })),
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

      myTestSbot.close();
      t.end();
    }),
  );
});

test('threads.profileSummary gives threads for lucy not mary', t => {
  const myTestSbot = CreateTestSbot({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test1',
    keys: lucyKeys,
  });

  const lucy = myTestSbot.createFeed(lucyKeys);
  const mary = myTestSbot.createFeed(maryKeys);
  let rootId;

  pull(
    pullAsync(cb => {
      lucy.add({ type: 'post', text: 'Root from lucy' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      rootId = rootMsg.key;
      mary.add({ type: 'post', text: 'Root from mary' }, cb);
    }),
    pull.asyncMap((_, cb) => {
      lucy.add({ type: 'post', text: 'Reply from lucy', root: rootId }, cb);
    }),
    pull.map(() => myTestSbot.threads.profileSummary({ id: lucy.id })),
    pull.flatten(),

    pull.collect((err, summaries) => {
      t.error(err);
      t.equals(summaries.length, 1, 'only one summary');
      const summary = summaries[0];
      t.equals(summary.replyCount, 1, 'summary counts 1 reply');
      t.equals(summary.root.value.content.root, undefined, 'root message is root');
      t.equals(summary.root.value.content.text, 'Root from lucy');

      myTestSbot.close();
      t.end();
    }),
  );
});

test('threads.private gives a simple well-formed thread', t => {
  const myTestSbot = CreateTestSbot({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test1',
    keys: lucyKeys,
  });

  const lucy = myTestSbot.createFeed(lucyKeys);
  let rootKey;

  pull(
    pullAsync(cb => {
      myTestSbot.private.publish(
        { type: 'post', text: 'Secret thread root' },
        [myTestSbot.id],
        cb,
      );
    }),
    pull.asyncMap((rootMsg, cb) => {
      rootKey = rootMsg.key;
      myTestSbot.private.publish(
        { type: 'post', text: 'Second secret message', root: rootKey },
        [myTestSbot.id],
        cb,
      );
    }),
    pull.asyncMap((_prevMsg, cb) => {
      myTestSbot.private.publish(
        { type: 'post', text: 'Third secret message', root: rootKey },
        [myTestSbot.id],
        cb,
      );
    }),
    pull.map(() => myTestSbot.threads.private({})),
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
        myTestSbot.threads.public({}),
        pull.collect((err, threads) => {
          t.error(err);
          t.equals(threads.length, 0, 'there are no public threads');
          myTestSbot.close();
          t.end();
        }),
      );
    }),
  );
});

test('threads.privateUpdates notifies of new thread or new msg', t => {
  const myTestSbot = CreateTestSbot({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test6',
    keys: lucyKeys,
  });

  const lucy = myTestSbot.createFeed(lucyKeys);
  const mary = myTestSbot.createFeed(maryKeys);

  let updates = 0;

  pull(
    myTestSbot.threads.privateUpdates({}),
    pull.drain(() => {
      updates++;
    }),
  );

  pull(
    pullAsync(cb => {
      lucy.add(
        ssbKeys.box({ type: 'post', text: 'A: root' }, [lucy.id, mary.id]),
        wait(cb),
      );
    }),
    pull.asyncMap((rootMsg, cb) => {
      t.equals(updates, 0);
      const root = rootMsg.key;
      mary.add(
        ssbKeys.box({ type: 'post', text: 'A: 2nd', root }, [lucy.id, mary.id]),
        wait(cb),
      );
    }),
    pull.asyncMap((_, cb) => {
      t.equals(updates, 1);
      mary.add(
        ssbKeys.box({ type: 'post', text: 'B: root' }, [lucy.id, mary.id]),
        wait(cb),
      );
    }),
    pull.asyncMap((rootMsg, cb) => {
      t.equals(updates, 2);
      const root = rootMsg.key;
      lucy.add(
        ssbKeys.box({ type: 'post', text: 'B: 2nd', root }, [lucy.id, mary.id]),
        wait(cb),
      );
    }),

    pull.drain(() => {
      t.equals(updates, 2);
      myTestSbot.close();
      t.end();
    }),
  );
});

test('threads.thread gives one full thread', t => {
  const myTestSbot = CreateTestSbot({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test7',
    keys: lucyKeys,
  });

  const lucy = myTestSbot.createFeed(lucyKeys);

  let rootAkey;
  pull(
    pullAsync(cb => {
      lucy.add({ type: 'post', text: 'A: root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      rootAkey = rootMsg.key;
      lucy.add({ type: 'post', text: 'A: 2nd', root: rootMsg.key }, cb);
    }),
    pull.asyncMap((prevMsg, cb) => {
      const rootKey = prevMsg.value.content.root;
      lucy.add({ type: 'post', text: 'A: 3rd', root: rootKey }, cb);
    }),

    pull.map(() => myTestSbot.threads.thread({ root: rootAkey })),
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
      myTestSbot.close();
      t.end();
    }),
  );
});

test('threads.thread can be called twice consecutively (to use cache)', t => {
  const myTestSbot = CreateTestSbot({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test7',
    keys: lucyKeys,
  });

  const lucy = myTestSbot.createFeed(lucyKeys);

  let rootAkey;
  pull(
    pullAsync(cb => {
      lucy.add({ type: 'post', text: 'A: root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      rootAkey = rootMsg.key;
      lucy.add({ type: 'post', text: 'A: 2nd', root: rootMsg.key }, cb);
    }),
    pull.asyncMap((prevMsg, cb) => {
      const rootKey = prevMsg.value.content.root;
      lucy.add({ type: 'post', text: 'A: 3rd', root: rootKey }, cb);
    }),

    pull.map(() =>
      cat([
        myTestSbot.threads.thread({ root: rootAkey }),
        myTestSbot.threads.thread({ root: rootAkey }),
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
      myTestSbot.close();
      t.end();
    }),
  );
});

test('threads.thread (by default) cannot view private conversations', t => {
  const myTestSbot = CreateTestSbot({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test1',
    keys: lucyKeys,
  });

  const lucy = myTestSbot.createFeed(lucyKeys);
  let rootKey;

  pull(
    pullAsync(cb => {
      myTestSbot.private.publish(
        { type: 'post', text: 'Secret thread root' },
        [myTestSbot.id],
        cb,
      );
    }),
    pull.asyncMap((rootMsg, cb) => {
      rootKey = rootMsg.key;
      myTestSbot.private.publish(
        { type: 'post', text: 'Second secret message', root: rootKey },
        [myTestSbot.id],
        cb,
      );
    }),
    pull.asyncMap((_prevMsg, cb) => {
      myTestSbot.private.publish(
        { type: 'post', text: 'Third secret message', root: rootKey },
        [myTestSbot.id],
        cb,
      );
    }),
    pull.map(() => myTestSbot.threads.thread({ root: rootKey })),
    pull.flatten(),

    pull.collect((err, threads) => {
      t.error(err, 'no error');
      t.equals(threads.length, 0, 'no threads arrived');
      myTestSbot.close();
      t.end();
    }),
  );
});

test('threads.thread can view private conversations given opts.private', t => {
  const myTestSbot = CreateTestSbot({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test1',
    keys: lucyKeys,
  });

  const lucy = myTestSbot.createFeed(lucyKeys);
  let rootKey;

  pull(
    pullAsync(cb => {
      myTestSbot.private.publish(
        { type: 'post', text: 'Secret thread root' },
        [myTestSbot.id],
        cb,
      );
    }),
    pull.asyncMap((rootMsg, cb) => {
      rootKey = rootMsg.key;
      myTestSbot.private.publish(
        { type: 'post', text: 'Second secret message', root: rootKey },
        [myTestSbot.id],
        cb,
      );
    }),
    pull.asyncMap((_prevMsg, cb) => {
      myTestSbot.private.publish(
        { type: 'post', text: 'Third secret message', root: rootKey },
        [myTestSbot.id],
        cb,
      );
    }),
    pull.map(() => myTestSbot.threads.thread({ root: rootKey, private: true })),
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
      myTestSbot.close();
      t.end();
    }),
  );
});

test('threads.threadUpdates notifies of new reply to that thread', t => {
  const myTestSbot = CreateTestSbot({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test6',
    keys: lucyKeys,
  });

  const lucy = myTestSbot.createFeed(lucyKeys);
  const mary = myTestSbot.createFeed(maryKeys);

  let updates = 0;

  pull(
    pullAsync(cb => {
      lucy.add({ type: 'post', text: 'A: root' }, wait(cb));
    }),
    pull.asyncMap((rootMsg, cb) => {
      pull(
        myTestSbot.threads.threadUpdates({ root: rootMsg.key }),
        pull.drain(msg => {
          t.equals(msg.value.content.root, rootMsg.key, 'got update');
          updates++;
        }),
      );

      t.equals(updates, 0);
      mary.add({ type: 'post', text: 'A: 2nd', root: rootMsg.key }, wait(cb));
    }),
    pull.asyncMap((_, cb) => {
      t.equals(updates, 1);
      mary.add({ type: 'post', text: 'B: root' }, wait(cb));
    }),
    pull.asyncMap((rootMsg, cb) => {
      t.equals(updates, 1);
      lucy.add({ type: 'post', text: 'B: 2nd', root: rootMsg.key }, wait(cb));
    }),

    pull.drain(() => {
      t.equals(updates, 1);
      myTestSbot.close();
      t.end();
    }),
  );
});

test('threads.threadUpdates (by default) cannot see private replies', t => {
  const myTestSbot = CreateTestSbot({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test6',
    keys: lucyKeys,
  });

  const lucy = myTestSbot.createFeed(lucyKeys);
  const mary = myTestSbot.createFeed(maryKeys);

  let updates = 0;

  pull(
    pullAsync(cb => {
      lucy.add(
        ssbKeys.box({ type: 'post', text: 'A: root' }, [lucy.id, mary.id]),
        wait(cb),
      );
    }),
    pull.asyncMap((rootMsg, cb) => {
      pull(
        myTestSbot.threads.threadUpdates({ root: rootMsg.key }),
        pull.drain(m => {
          t.fail('should not get an update');
          updates++;
        }),
      );

      t.equals(updates, 0);

      mary.add(
        ssbKeys.box({ type: 'post', text: 'A: 2nd', root: rootMsg.key }, [
          lucy.id,
          mary.id,
        ]),
        wait(cb),
      );
    }),
    pull.asyncMap((_, cb) => {
      t.equals(updates, 0);
      mary.add(
        ssbKeys.box({ type: 'post', text: 'B: root' }, [lucy.id, mary.id]),
        wait(cb),
      );
    }),
    pull.asyncMap((rootMsg, cb) => {
      t.equals(updates, 0);
      lucy.add(
        ssbKeys.box({ type: 'post', text: 'B: 2nd', root: rootMsg.key }, [
          lucy.id,
          mary.id,
        ]),
        wait(cb),
      );
    }),

    pull.drain(() => {
      t.equals(updates, 0);
      myTestSbot.close();
      t.end();
    }),
  );
});

test('threads.threadUpdates can view private replies given opts.private', t => {
  const myTestSbot = CreateTestSbot({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test6',
    keys: lucyKeys,
  });

  const lucy = myTestSbot.createFeed(lucyKeys);
  const mary = myTestSbot.createFeed(maryKeys);

  let updates = 0;

  pull(
    pullAsync(cb => {
      lucy.add(
        ssbKeys.box({ type: 'post', text: 'A: root' }, [lucy.id, mary.id]),
        wait(cb),
      );
    }),
    pull.asyncMap((rootMsg, cb) => {
      pull(
        myTestSbot.threads.threadUpdates({ root: rootMsg.key, private: true }),
        pull.drain(msg => {
          t.equals(msg.value.content.root, rootMsg.key, 'got update');
          updates++;
        }),
      );

      t.equals(updates, 0);

      mary.add(
        ssbKeys.box({ type: 'post', text: 'A: 2nd', root: rootMsg.key }, [
          lucy.id,
          mary.id,
        ]),
        wait(cb),
      );
    }),
    pull.asyncMap((_, cb) => {
      t.equals(updates, 1);
      mary.add(
        ssbKeys.box({ type: 'post', text: 'B: root' }, [lucy.id, mary.id]),
        wait(cb),
      );
    }),
    pull.asyncMap((rootMsg, cb) => {
      t.equals(updates, 1);
      lucy.add(
        ssbKeys.box({ type: 'post', text: 'B: 2nd', root: rootMsg.key }, [
          lucy.id,
          mary.id,
        ]),
        wait(cb),
      );
    }),

    pull.drain(() => {
      t.equals(updates, 1);
      myTestSbot.close();
      t.end();
    }),
  );
});

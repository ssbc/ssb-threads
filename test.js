const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('tape');
const pull = require('pull-stream');
const ssbKeys = require('ssb-keys');
const pullAsync = require('pull-async');

const CreateTestSbot = require('ssb-server/index')
  .use(require('ssb-backlinks'))
  .use(require('./lib/index'));

const lucyKeys = ssbKeys.generate();
const maryKeys = ssbKeys.generate();

test('threads.public gives a simple well-formed thread', t => {
  const myTestSbot = CreateTestSbot({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'conntest-')),
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

test('threads.public respects threadMaxSize opt', t => {
  const myTestSbot = CreateTestSbot({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'conntest-')),
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
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'conntest-')),
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
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'conntest-')),
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
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'conntest-')),
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
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'conntest-')),
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

test('threads.publicUpdates notifies of new thread or new msg', t => {
  const myTestSbot = CreateTestSbot({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'conntest-')),
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

  function wait(cb) {
    return (err, data) => {
      setTimeout(() => cb(err, data), 100);
    };
  }

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

test('threads.thread gives one full thread', t => {
  const myTestSbot = CreateTestSbot({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'conntest-')),
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

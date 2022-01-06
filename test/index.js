const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('tape');
const pull = require('pull-stream');
const ssbKeys = require('ssb-keys');
const SecretStack = require('secret-stack');
const caps = require('ssb-caps');
const validate = require('ssb-validate');
const pullAsync = require('pull-async');
const cat = require('pull-cat');

const CreateSSB = SecretStack({ appKey: caps.shs })
  .use(require('ssb-db2'))
  .use(require('../lib/index'));

const lucyKeys = ssbKeys.generate();
const maryKeys = ssbKeys.generate();

function wait(cb) {
  return (err, data) => {
    setTimeout(() => cb(err, data), 300);
  };
}

test('threads.public gives a simple well-formed thread', (t) => {
  const ssb = CreateSSB({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test1',
    keys: lucyKeys,
  });

  let state = validate.initial();

  state = validate.appendNew(
    state,
    null,
    lucyKeys,
    { type: 'post', text: 'Thread root' },
    Date.now(),
  );
  state = validate.appendNew(
    state,
    null,
    lucyKeys,
    { type: 'post', text: 'Second message', root: state.queue[0].key },
    Date.now() + 1,
  );
  state = validate.appendNew(
    state,
    null,
    lucyKeys,
    { type: 'post', text: 'Third message', root: state.queue[0].key },
    Date.now() + 2,
  );

  pull(
    pullAsync((cb) => {
      ssb.db.add(state.queue[0].value, cb);
    }),
    pull.asyncMap((_, cb) => {
      ssb.db.add(state.queue[1].value, cb);
    }),
    pull.asyncMap((_, cb) => {
      ssb.db.add(state.queue[2].value, cb);
    }),
    pull.map(() => ssb.threads.public({})),
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
      ssb.close(t.end);
    }),
  );
});

test('threads.public can be called twice consecutively (to use cache)', (t) => {
  const ssb = CreateSSB({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test1',
    keys: lucyKeys,
  });

  pull(
    pullAsync((cb) => {
      ssb.db.publish({ type: 'post', text: 'Thread root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      ssb.db.publish(
        { type: 'post', text: 'Second message', root: rootMsg.key },
        cb,
      );
    }),
    pull.asyncMap((prevMsg, cb) => {
      const rootKey = prevMsg.value.content.root;
      ssb.db.publish(
        { type: 'post', text: 'Third message', root: rootKey },
        cb,
      );
    }),
    pull.map(() => cat([ssb.threads.public({}), ssb.threads.public({})])),
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
      ssb.close(t.end);
    }),
  );
});

test('threads.public does not show any private threads', (t) => {
  const ssb = CreateSSB({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test1',
    keys: lucyKeys,
  });

  pull(
    pullAsync((cb) => {
      ssb.db.publish(
        ssbKeys.box({ type: 'post', text: 'Secret thread root' }, [ssb.id]),
        cb,
      );
    }),
    pull.asyncMap((_, cb) => {
      ssb.db.publish({ type: 'post', text: 'Thread root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      ssb.db.publish(
        { type: 'post', text: 'Second message', root: rootMsg.key },
        cb,
      );
    }),
    pull.asyncMap((prevMsg, cb) => {
      const rootKey = prevMsg.value.content.root;
      ssb.db.publish(
        { type: 'post', text: 'Third message', root: rootKey },
        cb,
      );
    }),
    pull.map(() => ssb.threads.public({})),
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
      ssb.close(t.end);
    }),
  );
});

test('threads.public respects threadMaxSize opt', (t) => {
  const ssb = CreateSSB({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test2',
    keys: lucyKeys,
  });

  pull(
    pullAsync((cb) => {
      ssb.db.publish({ type: 'post', text: 'Thread root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      ssb.db.publish(
        { type: 'post', text: 'Second message', root: rootMsg.key },
        cb,
      );
    }),
    pull.asyncMap((prevMsg, cb) => {
      const rootKey = prevMsg.value.content.root;
      ssb.db.publish(
        { type: 'post', text: 'Third message', root: rootKey },
        cb,
      );
    }),
    pull.map(() => ssb.threads.public({ threadMaxSize: 2 })),
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
      ssb.close();
      t.end();
    }),
  );
});

test('threads.public respects allowlist opt', (t) => {
  const ssb = CreateSSB({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test3',
    keys: lucyKeys,
  });

  pull(
    pullAsync((cb) => {
      ssb.db.publish({ type: 'post', text: 'Thread root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      ssb.db.publish(
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
      ssb.db.publish({ type: 'shout', text: 'AAAHHH' }, cb);
    }),
    pull.map(() => ssb.threads.public({ allowlist: ['shout'] })),
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
      ssb.close();
      t.end();
    }),
  );
});

test('threads.public applies allowlist to roots too', (t) => {
  const ssb = CreateSSB({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test3b',
    keys: lucyKeys,
  });

  pull(
    pullAsync((cb) => {
      ssb.db.publish({ type: 'post', text: 'Thread root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      ssb.db.publish({ type: 'shout', root: rootMsg, text: 'NOOOOOO' }, cb);
    }),
    pull.asyncMap((_prevMsg, cb) => {
      ssb.db.publish({ type: 'shout', text: 'AAAHHH' }, cb);
    }),
    pull.map(() => ssb.threads.public({ allowlist: ['shout'] })),
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
      ssb.close();
      t.end();
    }),
  );
});

test('threads.public respects blocklist opt', (t) => {
  const ssb = CreateSSB({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test4',
    keys: lucyKeys,
  });

  pull(
    pullAsync((cb) => {
      ssb.db.publish({ type: 'post', text: 'Thread root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      ssb.db.publish(
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
      ssb.db.publish({ type: 'shout', text: 'AAAHHH' }, cb);
    }),
    pull.map(() => ssb.threads.public({ blocklist: ['shout', 'vote'] })),
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
      ssb.close();
      t.end();
    }),
  );
});

test('threads.public gives multiple threads', (t) => {
  const ssb = CreateSSB({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test5',
    keys: lucyKeys,
  });

  pull(
    pullAsync((cb) => {
      ssb.db.publish({ type: 'post', text: 'A: root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      ssb.db.publish({ type: 'post', text: 'A: 2nd', root: rootMsg.key }, cb);
    }),
    pull.asyncMap((prevMsg, cb) => {
      const rootKey = prevMsg.value.content.root;
      ssb.db.publish({ type: 'post', text: 'A: 3rd', root: rootKey }, cb);
    }),
    pull.asyncMap((_, cb) => {
      ssb.db.publish({ type: 'post', text: 'B: root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      ssb.db.publish({ type: 'post', text: 'B: 2nd', root: rootMsg.key }, cb);
    }),

    pull.map(() => ssb.threads.public({ reverse: true })),
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
      ssb.close();
      t.end();
    }),
  );
});

test('threads.public sorts threads by recency', (t) => {
  const ssb = CreateSSB({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test5',
    keys: lucyKeys,
  });

  let rootAkey;
  pull(
    pullAsync((cb) => {
      ssb.db.publish({ type: 'post', text: 'A: root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      rootAkey = rootMsg.key;
      ssb.db.publish({ type: 'post', text: 'A: 2nd', root: rootMsg.key }, cb);
    }),
    pull.asyncMap((_, cb) => {
      ssb.db.publish({ type: 'post', text: 'B: root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      ssb.db.publish({ type: 'post', text: 'B: 2nd', root: rootMsg.key }, cb);
    }),
    pull.asyncMap((_, cb) => {
      ssb.db.publish({ type: 'post', text: 'A: 3rd', root: rootAkey }, cb);
    }),

    pull.map(() => ssb.threads.public({ reverse: true })),
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
      ssb.close(t.end);
    }),
  );
});

test('threads.public ignores threads where root msg is missing', (t) => {
  const ssb = CreateSSB({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test5',
    keys: lucyKeys,
  });

  let rootAkey;
  pull(
    pullAsync((cb) => {
      ssb.db.publish({ type: 'post', text: 'A: root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      rootAkey = rootMsg.key;
      ssb.db.publish({ type: 'post', text: 'A: 2nd', root: rootMsg.key }, cb);
    }),
    pull.asyncMap((_, cb) => {
      ssb.db.publish(
        { type: 'post', text: 'B: 2nd', root: rootAkey.toLowerCase() },
        cb,
      );
    }),
    pull.asyncMap((_, cb) => {
      ssb.db.publish({ type: 'post', text: 'A: 3rd', root: rootAkey }, cb);
    }),

    pull.map(() => ssb.threads.public({ reverse: true })),
    pull.flatten(),

    pull.collect((err, threads) => {
      t.error(err);
      t.equals(threads.length, 1, 'has one thread');
      const [a] = threads;
      t.equals(a.full, true, '1st thread comes back full');
      t.equals(a.messages.length, 3, '1st thread has 3 messages');
      t.equals(a.messages[0].value.content.text, 'A: root', '1st thread is A');
      ssb.close(t.end);
    }),
  );
});

test('threads.publicSummary gives a simple well-formed summary', (t) => {
  const ssb = CreateSSB({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test1',
    keys: lucyKeys,
  });

  pull(
    pullAsync((cb) => {
      ssb.db.publish({ type: 'post', text: 'Thread root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      ssb.db.publish(
        { type: 'post', text: 'Second message', root: rootMsg.key },
        cb,
      );
    }),
    pull.asyncMap((prevMsg, cb) => {
      const rootKey = prevMsg.value.content.root;
      ssb.db.publish(
        { type: 'post', text: 'Third message', root: rootKey },
        cb,
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
  const ssb = CreateSSB({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'testHundreds',
    keys: lucyKeys,
  });

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

test('threads.publicUpdates notifies of new thread or new msg', (t) => {
  const ssb = CreateSSB({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test6',
    keys: lucyKeys,
  });

  let state = validate.initial();

  state = validate.appendNew(
    state,
    null,
    lucyKeys,
    { type: 'post', text: 'A: root' },
    Date.now(),
  );
  state = validate.appendNew(
    state,
    null,
    maryKeys,
    { type: 'post', text: 'A: 2nd', root: state.queue[0].key },
    Date.now() + 1,
  );
  state = validate.appendNew(
    state,
    null,
    maryKeys,
    { type: 'post', text: 'B: root' },
    Date.now() + 2,
  );
  state = validate.appendNew(
    state,
    null,
    lucyKeys,
    { type: 'post', text: 'B: 2nd', root: state.queue[2].key },
    Date.now() + 3,
  );

  let updates = 0;

  let liveDrainer;
  pull(
    ssb.threads.publicUpdates({}),
    (liveDrainer = pull.drain(() => {
      updates++;
    })),
  );

  pull(
    pullAsync((cb) => {
      ssb.db.add(state.queue[0].value, wait(cb));
    }),
    pull.asyncMap((_, cb) => {
      t.equals(updates, 0);
      ssb.db.add(state.queue[1].value, wait(cb));
    }),
    pull.asyncMap((_, cb) => {
      t.equals(updates, 1);
      ssb.db.add(state.queue[2].value, wait(cb));
    }),
    pull.asyncMap((_, cb) => {
      t.equals(updates, 2);
      ssb.db.add(state.queue[3].value, wait(cb));
    }),

    pull.drain(() => {
      t.equals(updates, 2, 'total updates');
      liveDrainer.abort();
      ssb.close(t.end);
    }),
  );
});

test('threads.publicUpdates respects includeSelf opt', (t) => {
  const ssb = CreateSSB({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test6',
    keys: lucyKeys,
  });

  let state = validate.initial();

  state = validate.appendNew(
    state,
    null,
    lucyKeys,
    { type: 'post', text: 'A: root' },
    Date.now(),
  );
  state = validate.appendNew(
    state,
    null,
    maryKeys,
    { type: 'post', text: 'A: 2nd', root: state.queue[0].key },
    Date.now() + 1,
  );
  state = validate.appendNew(
    state,
    null,
    maryKeys,
    { type: 'post', text: 'B: root' },
    Date.now() + 2,
  );
  state = validate.appendNew(
    state,
    null,
    lucyKeys,
    { type: 'post', text: 'B: 2nd', root: state.queue[2].key },
    Date.now() + 3,
  );

  let updates = 0;

  let liveDrainer;
  pull(
    ssb.threads.publicUpdates({ includeSelf: true }),
    (liveDrainer = pull.drain(() => {
      updates++;
    })),
  );

  pull(
    pullAsync((cb) => {
      ssb.db.add(state.queue[0].value, wait(cb));
    }),
    pull.asyncMap((_, cb) => {
      t.equals(updates, 1);
      ssb.db.add(state.queue[1].value, wait(cb));
    }),
    pull.asyncMap((_, cb) => {
      t.equals(updates, 2);
      ssb.db.add(state.queue[2].value, wait(cb));
    }),
    pull.asyncMap((_, cb) => {
      t.equals(updates, 3);
      ssb.db.add(state.queue[3].value, wait(cb));
    }),

    pull.drain(() => {
      t.equals(updates, 4, 'total updates');
      liveDrainer.abort();
      ssb.close(t.end);
    }),
  );
});

test('threads.hashtagSummary understands msg.value.content.channel', (t) => {
  const ssb = CreateSSB({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test-hashtag1')),
    temp: true,
    name: 'test1',
    keys: lucyKeys,
  });

  pull(
    pullAsync((cb) => {
      ssb.db.publish(
        { type: 'post', text: 'Pizza', channel: 'food' },
        (err, x) => {
          setTimeout(() => {
            cb(err, x);
          }, 100);
        },
      );
    }),
    pull.asyncMap((rootMsg, cb) => {
      ssb.db.publish(
        { type: 'post', text: 'pepperoni', root: rootMsg.key },
        (err, x) => {
          setTimeout(() => {
            cb(err, x);
          }, 100);
        },
      );
    }),
    pull.asyncMap((prevMsg, cb) => {
      ssb.db.publish({ type: 'post', text: 'Third message' }, (err) => {
        setTimeout(() => {
          cb(err, null);
        }, 100);
      });
    }),
    pull.map(() => ssb.threads.hashtagSummary({ hashtag: 'food' })),
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
      t.equals(summary.root.value.content.text, 'Pizza');

      ssb.close(t.end);
    }),
  );
});

test('threads.hashtagSummary input is case-insensitive', (t) => {
  const ssb = CreateSSB({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test-hashtag1')),
    temp: true,
    name: 'test1',
    keys: lucyKeys,
  });

  pull(
    pullAsync((cb) => {
      ssb.db.publish(
        { type: 'post', text: 'Pizza', channel: 'Food' },
        (err, x) => {
          setTimeout(() => {
            cb(err, x);
          }, 100);
        },
      );
    }),
    pull.asyncMap((rootMsg, cb) => {
      ssb.db.publish(
        { type: 'post', text: 'pepperoni', root: rootMsg.key },
        (err, x) => {
          setTimeout(() => {
            cb(err, x);
          }, 100);
        },
      );
    }),
    pull.asyncMap((prevMsg, cb) => {
      ssb.db.publish({ type: 'post', text: 'Third message' }, (err) => {
        setTimeout(() => {
          cb(err, null);
        }, 100);
      });
    }),
    pull.map(() => ssb.threads.hashtagSummary({ hashtag: 'food' })),
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
      t.equals(summary.root.value.content.text, 'Pizza');

      ssb.close(t.end);
    }),
  );
});

test('threads.hashtagSummary understands msg.value.content.mentions', (t) => {
  const ssb = CreateSSB({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test-hashtag2')),
    temp: true,
    name: 'test1',
    keys: lucyKeys,
  });

  pull(
    pullAsync((cb) => {
      ssb.db.publish(
        { type: 'post', text: 'Dog', mentions: [{ link: '#animals' }] },
        (err, x) => {
          setTimeout(() => {
            cb(err, x);
          }, 100);
        },
      );
    }),
    pull.asyncMap((rootMsg, cb) => {
      ssb.db.publish(
        { type: 'post', text: 'poodle', root: rootMsg.key },
        (err, x) => {
          setTimeout(() => {
            cb(err, x);
          }, 100);
        },
      );
    }),
    pull.asyncMap((prevMsg, cb) => {
      ssb.db.publish({ type: 'post', text: 'Cat' }, (err) => {
        setTimeout(() => {
          cb(err, null);
        }, 100);
      });
    }),
    pull.map(() => ssb.threads.hashtagSummary({ hashtag: 'animals' })),
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
      t.equals(summary.root.value.content.text, 'Dog');

      ssb.close(t.end);
    }),
  );
});

test('threads.profile gives threads for lucy not mary', (t) => {
  const ssb = CreateSSB({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test1',
    keys: lucyKeys,
  });

  let state = validate.initial();

  state = validate.appendNew(
    state,
    null,
    lucyKeys,
    { type: 'post', text: 'Root from lucy' },
    Date.now(),
  );
  state = validate.appendNew(
    state,
    null,
    maryKeys,
    { type: 'post', text: 'Root from mary' },
    Date.now() + 1,
  );
  state = validate.appendNew(
    state,
    null,
    lucyKeys,
    { type: 'post', text: 'Reply from lucy', root: state.queue[0].key },
    Date.now() + 2,
  );

  pull(
    pullAsync((cb) => {
      ssb.db.add(state.queue[0].value, wait(cb));
    }),
    pull.asyncMap((_, cb) => {
      ssb.db.add(state.queue[1].value, wait(cb));
    }),
    pull.asyncMap((_, cb) => {
      ssb.db.add(state.queue[2].value, wait(cb));
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

test('threads.profileSummary gives threads for lucy not mary', (t) => {
  const ssb = CreateSSB({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test1',
    keys: lucyKeys,
  });

  let state = validate.initial();

  state = validate.appendNew(
    state,
    null,
    lucyKeys,
    { type: 'post', text: 'Root from lucy' },
    Date.now(),
  );
  state = validate.appendNew(
    state,
    null,
    maryKeys,
    { type: 'post', text: 'Root from mary' },
    Date.now() + 1,
  );
  state = validate.appendNew(
    state,
    null,
    lucyKeys,
    { type: 'post', text: 'Reply from lucy', root: state.queue[0].key },
    Date.now() + 2,
  );

  pull(
    pullAsync((cb) => {
      ssb.db.add(state.queue[0].value, wait(cb));
    }),
    pull.asyncMap((_, cb) => {
      ssb.db.add(state.queue[1].value, wait(cb));
    }),
    pull.asyncMap((_, cb) => {
      ssb.db.add(state.queue[2].value, wait(cb));
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
  const ssb = CreateSSB({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test1',
    keys: lucyKeys,
  });

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

test('threads.private gives a simple well-formed thread', (t) => {
  const ssb = CreateSSB({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test1',
    keys: lucyKeys,
  });

  let rootKey;
  pull(
    pullAsync((cb) => {
      ssb.db.publish(
        ssbKeys.box({ type: 'post', text: 'Secret thread root' }, [ssb.id]),
        cb,
      );
    }),
    pull.asyncMap((rootMsg, cb) => {
      rootKey = rootMsg.key;
      ssb.db.publish(
        ssbKeys.box(
          { type: 'post', text: 'Second secret message', root: rootKey },
          [ssb.id],
        ),
        cb,
      );
    }),
    pull.asyncMap((_prevMsg, cb) => {
      ssb.db.publish(
        ssbKeys.box(
          { type: 'post', text: 'Third secret message', root: rootKey },
          [ssb.id],
        ),
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

test('threads.privateUpdates notifies of new thread or new msg', (t) => {
  const ssb = CreateSSB({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test6',
    keys: lucyKeys,
  });

  let state = validate.initial();

  state = validate.appendNew(
    state,
    null,
    lucyKeys,
    ssbKeys.box({ type: 'post', text: 'A: root' }, [lucyKeys.id, maryKeys.id]),
    Date.now(),
  );
  state = validate.appendNew(
    state,
    null,
    maryKeys,
    ssbKeys.box({ type: 'post', text: 'A: 2nd', root: state.queue[0].key }, [
      lucyKeys.id,
      maryKeys.id,
    ]),
    Date.now() + 1,
  );
  state = validate.appendNew(
    state,
    null,
    maryKeys,
    ssbKeys.box({ type: 'post', text: 'B: root' }, [lucyKeys.id, maryKeys.id]),
    Date.now() + 2,
  );
  state = validate.appendNew(
    state,
    null,
    lucyKeys,
    ssbKeys.box({ type: 'post', text: 'B: 2nd', root: state.queue[2].key }, [
      lucyKeys.id,
      maryKeys.id,
    ]),
    Date.now() + 3,
  );

  let updates = 0;
  let liveDrainer;
  pull(
    ssb.threads.privateUpdates({}),
    (liveDrainer = pull.drain(() => {
      updates++;
    })),
  );

  pull(
    pullAsync((cb) => {
      ssb.db.add(state.queue[0].value, wait(cb));
    }),
    pull.asyncMap((_, cb) => {
      t.equals(updates, 0);
      ssb.db.add(state.queue[1].value, wait(cb));
    }),
    pull.asyncMap((_, cb) => {
      t.equals(updates, 1);
      ssb.db.add(state.queue[2].value, wait(cb));
    }),
    pull.asyncMap((_, cb) => {
      t.equals(updates, 2);
      ssb.db.add(state.queue[3].value, wait(cb));
    }),

    pull.drain(() => {
      t.equals(updates, 2);
      liveDrainer.abort();
      ssb.close(t.end);
    }),
  );
});

test('threads.privateUpdates respects includeSelf', (t) => {
  const ssb = CreateSSB({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test6',
    keys: lucyKeys,
  });

  let state = validate.initial();

  state = validate.appendNew(
    state,
    null,
    lucyKeys,
    ssbKeys.box({ type: 'post', text: 'A: root' }, [lucyKeys.id, maryKeys.id]),
    Date.now(),
  );
  state = validate.appendNew(
    state,
    null,
    maryKeys,
    ssbKeys.box({ type: 'post', text: 'A: 2nd', root: state.queue[0].key }, [
      lucyKeys.id,
      maryKeys.id,
    ]),
    Date.now() + 1,
  );
  state = validate.appendNew(
    state,
    null,
    maryKeys,
    ssbKeys.box({ type: 'post', text: 'B: root' }, [lucyKeys.id, maryKeys.id]),
    Date.now() + 2,
  );
  state = validate.appendNew(
    state,
    null,
    lucyKeys,
    ssbKeys.box({ type: 'post', text: 'B: 2nd', root: state.queue[2].key }, [
      lucyKeys.id,
      maryKeys.id,
    ]),
    Date.now() + 3,
  );

  let updates = 0;
  let liveDrainer;
  pull(
    ssb.threads.privateUpdates({ includeSelf: true }),
    (liveDrainer = pull.drain(() => {
      updates++;
    })),
  );

  pull(
    pullAsync((cb) => {
      ssb.db.add(state.queue[0].value, wait(cb));
    }),
    pull.asyncMap((_, cb) => {
      t.equals(updates, 1);
      ssb.db.add(state.queue[1].value, wait(cb));
    }),
    pull.asyncMap((_, cb) => {
      t.equals(updates, 2);
      ssb.db.add(state.queue[2].value, wait(cb));
    }),
    pull.asyncMap((_, cb) => {
      t.equals(updates, 3);
      ssb.db.add(state.queue[3].value, wait(cb));
    }),

    pull.drain(() => {
      t.equals(updates, 4);
      liveDrainer.abort();
      ssb.close(t.end);
    }),
  );
});

test('threads.thread gives one full thread', (t) => {
  const ssb = CreateSSB({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test7',
    keys: lucyKeys,
  });

  let rootAkey;
  pull(
    pullAsync((cb) => {
      ssb.db.publish({ type: 'post', text: 'A: root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      rootAkey = rootMsg.key;
      ssb.db.publish({ type: 'post', text: 'A: 2nd', root: rootMsg.key }, cb);
    }),
    pull.asyncMap((prevMsg, cb) => {
      const rootKey = prevMsg.value.content.root;
      ssb.db.publish({ type: 'post', text: 'A: 3rd', root: rootKey }, cb);
    }),

    pull.map(() => ssb.threads.thread({ root: rootAkey })),
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
      ssb.close(t.end);
    }),
  );
});

test('threads.thread can be called twice consecutively (to use cache)', (t) => {
  const ssb = CreateSSB({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test7',
    keys: lucyKeys,
  });

  let rootAkey;
  pull(
    pullAsync((cb) => {
      ssb.db.publish({ type: 'post', text: 'A: root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      rootAkey = rootMsg.key;
      ssb.db.publish({ type: 'post', text: 'A: 2nd', root: rootMsg.key }, cb);
    }),
    pull.asyncMap((prevMsg, cb) => {
      const rootKey = prevMsg.value.content.root;
      ssb.db.publish({ type: 'post', text: 'A: 3rd', root: rootKey }, cb);
    }),

    pull.map(() =>
      cat([
        ssb.threads.thread({ root: rootAkey }),
        ssb.threads.thread({ root: rootAkey }),
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
      ssb.close(t.end);
    }),
  );
});

test('threads.thread (by default) cannot view private conversations', (t) => {
  const ssb = CreateSSB({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test1',
    keys: lucyKeys,
  });

  let rootKey;

  pull(
    pullAsync((cb) => {
      ssb.db.publish(
        ssbKeys.box({ type: 'post', text: 'Secret thread root' }, [ssb.id]),
        cb,
      );
    }),
    pull.asyncMap((rootMsg, cb) => {
      rootKey = rootMsg.key;
      ssb.db.publish(
        ssbKeys.box(
          { type: 'post', text: 'Second secret message', root: rootKey },
          [ssb.id],
        ),
        cb,
      );
    }),
    pull.asyncMap((_prevMsg, cb) => {
      ssb.db.publish(
        ssbKeys.box(
          { type: 'post', text: 'Third secret message', root: rootKey },
          [ssb.id],
        ),
        cb,
      );
    }),
    pull.map(() => ssb.threads.thread({ root: rootKey })),
    pull.flatten(),

    pull.collect((err, threads) => {
      t.error(err, 'no error');
      t.equals(threads.length, 0, 'no threads arrived');
      ssb.close(t.end);
    }),
  );
});

test('threads.thread can view private conversations given opts.private', (t) => {
  const ssb = CreateSSB({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test1',
    keys: lucyKeys,
  });

  let rootKey;

  pull(
    pullAsync((cb) => {
      ssb.db.publish(
        ssbKeys.box({ type: 'post', text: 'Secret thread root' }, [ssb.id]),
        cb,
      );
    }),
    pull.asyncMap((rootMsg, cb) => {
      rootKey = rootMsg.key;
      ssb.db.publish(
        ssbKeys.box(
          { type: 'post', text: 'Second secret message', root: rootKey },
          [ssb.id],
        ),
        cb,
      );
    }),
    pull.asyncMap((_prevMsg, cb) => {
      ssb.db.publish(
        ssbKeys.box(
          { type: 'post', text: 'Third secret message', root: rootKey },
          [ssb.id],
        ),
        cb,
      );
    }),
    pull.map(() => ssb.threads.thread({ root: rootKey, private: true })),
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
      ssb.close(t.end);
    }),
  );
});

test('threads.threadUpdates notifies of new reply to that thread', (t) => {
  const ssb = CreateSSB({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test6',
    keys: lucyKeys,
  });

  let state = validate.initial();

  state = validate.appendNew(
    state,
    null,
    lucyKeys,
    { type: 'post', text: 'A: root' },
    Date.now(),
  );
  state = validate.appendNew(
    state,
    null,
    maryKeys,
    { type: 'post', text: 'A: 2nd', root: state.queue[0].key },
    Date.now() + 1,
  );
  state = validate.appendNew(
    state,
    null,
    maryKeys,
    { type: 'post', text: 'B: root' },
    Date.now() + 2,
  );
  state = validate.appendNew(
    state,
    null,
    lucyKeys,
    { type: 'post', text: 'B: 2nd', root: state.queue[2].key },
    Date.now() + 3,
  );

  let updates = 0;
  let liveDrainer;

  pull(
    pullAsync((cb) => {
      ssb.db.add(state.queue[0].value, wait(cb));
    }),
    pull.asyncMap((rootMsg, cb) => {
      pull(
        ssb.threads.threadUpdates({ root: rootMsg.key }),
        (liveDrainer = pull.drain((msg) => {
          t.equals(msg.value.content.root, rootMsg.key, 'got update');
          updates++;
        })),
      );

      setTimeout(() => {
        t.equals(updates, 0);
        ssb.db.add(state.queue[1].value, wait(cb));
      }, 300);
    }),
    pull.asyncMap((_, cb) => {
      t.equals(updates, 1);
      ssb.db.add(state.queue[2].value, wait(cb));
    }),
    pull.asyncMap((_, cb) => {
      t.equals(updates, 1);
      ssb.db.add(state.queue[3].value, wait(cb));
    }),

    pull.drain(() => {
      t.equals(updates, 1);
      liveDrainer.abort();
      ssb.close(t.end);
    }),
  );
});

test('threads.threadUpdates (by default) cannot see private replies', (t) => {
  const ssb = CreateSSB({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test6',
    keys: lucyKeys,
  });

  let state = validate.initial();

  state = validate.appendNew(
    state,
    null,
    lucyKeys,
    ssbKeys.box({ type: 'post', text: 'A: root' }, [lucyKeys.id, maryKeys.id]),
    Date.now(),
  );
  state = validate.appendNew(
    state,
    null,
    maryKeys,
    ssbKeys.box({ type: 'post', text: 'A: 2nd', root: state.queue[0].key }, [
      lucyKeys.id,
      maryKeys.id,
    ]),
    Date.now() + 1,
  );
  state = validate.appendNew(
    state,
    null,
    maryKeys,
    ssbKeys.box({ type: 'post', text: 'B: root' }, [lucyKeys.id, maryKeys.id]),
    Date.now() + 2,
  );
  state = validate.appendNew(
    state,
    null,
    lucyKeys,
    ssbKeys.box({ type: 'post', text: 'B: 2nd', root: state.queue[2].key }, [
      lucyKeys.id,
      maryKeys.id,
    ]),
    Date.now() + 3,
  );

  let updates = 0;
  let liveDrainer;

  pull(
    pullAsync((cb) => {
      ssb.db.add(state.queue[0].value, wait(cb));
    }),
    pull.asyncMap((rootMsg, cb) => {
      pull(
        ssb.threads.threadUpdates({ root: rootMsg.key }),
        (liveDrainer = pull.drain((m) => {
          t.fail('should not get an update');
          updates++;
        })),
      );

      setTimeout(() => {
        t.equals(updates, 0);
        ssb.db.add(state.queue[1].value, wait(cb));
      }, 300);
    }),
    pull.asyncMap((_, cb) => {
      t.equals(updates, 0);
      ssb.db.add(state.queue[2].value, wait(cb));
    }),
    pull.asyncMap((_, cb) => {
      t.equals(updates, 0);
      ssb.db.add(state.queue[3].value, wait(cb));
    }),

    pull.drain(() => {
      t.equals(updates, 0);
      liveDrainer.abort();
      ssb.close(t.end);
    }),
  );
});

test('threads.threadUpdates can view private replies given opts.private', (t) => {
  const ssb = CreateSSB({
    path: fs.mkdtempSync(path.join(os.tmpdir(), 'threads-test')),
    temp: true,
    name: 'test6',
    keys: lucyKeys,
  });

  let state = validate.initial();

  state = validate.appendNew(
    state,
    null,
    lucyKeys,
    ssbKeys.box({ type: 'post', text: 'A: root' }, [lucyKeys.id, maryKeys.id]),
    Date.now(),
  );
  state = validate.appendNew(
    state,
    null,
    maryKeys,
    ssbKeys.box({ type: 'post', text: 'A: 2nd', root: state.queue[0].key }, [
      lucyKeys.id,
      maryKeys.id,
    ]),
    Date.now() + 1,
  );
  state = validate.appendNew(
    state,
    null,
    maryKeys,
    ssbKeys.box({ type: 'post', text: 'B: root' }, [lucyKeys.id, maryKeys.id]),
    Date.now() + 2,
  );
  state = validate.appendNew(
    state,
    null,
    lucyKeys,
    ssbKeys.box({ type: 'post', text: 'B: 2nd', root: state.queue[2].key }, [
      lucyKeys.id,
      maryKeys.id,
    ]),
    Date.now() + 3,
  );

  let updates = 0;
  let liveDrainer;

  pull(
    pullAsync((cb) => {
      ssb.db.add(state.queue[0].value, wait(cb));
    }),
    pull.asyncMap((rootMsg, cb) => {
      pull(
        ssb.threads.threadUpdates({ root: rootMsg.key, private: true }),
        (liveDrainer = pull.drain((msg) => {
          t.equals(msg.value.content.root, rootMsg.key, 'got update');
          updates++;
        })),
      );

      setTimeout(() => {
        t.equals(updates, 0);
        ssb.db.add(state.queue[1].value, wait(cb));
      }, 300);
    }),
    pull.asyncMap((_, cb) => {
      t.equals(updates, 1);
      ssb.db.add(state.queue[2].value, wait(cb));
    }),
    pull.asyncMap((_, cb) => {
      t.equals(updates, 1);
      ssb.db.add(state.queue[3].value, wait(cb));
    }),

    pull.drain(() => {
      t.equals(updates, 1);
      liveDrainer.abort();
      ssb.close(t.end);
    }),
  );
});

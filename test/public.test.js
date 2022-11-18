const test = require('tape');
const pull = require('pull-stream');
const ssbKeys = require('ssb-keys');
const pullAsync = require('pull-async');
const cat = require('pull-cat');
const Testbot = require('./testbot');
const wait = require('./wait');

const lucyKeys = ssbKeys.generate(null, 'lucy');
const maryKeys = ssbKeys.generate(null, 'mary');
const aliceKeys = ssbKeys.generate(null, 'alice');

test('threads.public gives a simple well-formed thread', (t) => {
  const ssb = Testbot({ keys: lucyKeys });

  let msg1;
  pull(
    pullAsync((cb) => {
      ssb.db.create(
        {
          keys: lucyKeys,
          content: { type: 'post', text: 'Thread root' },
        },
        cb,
      );
    }),
    pull.asyncMap((msg, cb) => {
      msg1 = msg;
      ssb.db.create(
        {
          keys: lucyKeys,
          content: { type: 'post', text: 'Second message', root: msg1.key },
        },
        cb,
      );
    }),
    pull.asyncMap((msg, cb) => {
      ssb.db.create(
        {
          keys: lucyKeys,
          content: { type: 'post', text: 'Third message', root: msg1.key },
        },
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

test('threads.public can be called twice consecutively (to use cache)', (t) => {
  const ssb = Testbot({ keys: lucyKeys });

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
  const ssb = Testbot({
    keys: lucyKeys,
  });

  pull(
    pullAsync((cb) => {
      ssb.db.create(
        {
          keys: lucyKeys,
          content: { type: 'post', text: 'Secret thread root' },
          recps: [ssb.id],
          encryptionFormat: 'box',
        },
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
  const ssb = Testbot({
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
  const ssb = Testbot({
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
  const ssb = Testbot({
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
  const ssb = Testbot({
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
  const ssb = Testbot({
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
  const ssb = Testbot({
    keys: lucyKeys,
  });

  let rootAkey;
  pull(
    pullAsync((cb) => {
      ssb.db.publish({ type: 'post', text: 'A: root' }, wait(cb));
    }),
    pull.asyncMap((rootMsg, cb) => {
      rootAkey = rootMsg.key;
      ssb.db.publish(
        { type: 'post', text: 'A: 2nd', root: rootMsg.key },
        wait(cb, 800),
      );
    }),
    pull.asyncMap((_, cb) => {
      ssb.db.publish({ type: 'post', text: 'B: root' }, wait(cb));
    }),
    pull.asyncMap((rootMsg, cb) => {
      ssb.db.publish(
        { type: 'post', text: 'B: 2nd', root: rootMsg.key },
        wait(cb),
      );
    }),
    pull.asyncMap((_, cb) => {
      ssb.db.publish(
        { type: 'post', text: 'A: 3rd', root: rootAkey },
        wait(cb, 800),
      );
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
  const ssb = Testbot({
    keys: lucyKeys,
  });

  let rootAkey;
  pull(
    pullAsync((cb) => {
      ssb.db.publish({ type: 'post', text: 'A: root' }, wait(cb));
    }),
    pull.asyncMap((rootMsg, cb) => {
      rootAkey = rootMsg.key;
      ssb.db.publish(
        { type: 'post', text: 'A: 2nd', root: rootMsg.key },
        wait(cb, 800),
      );
    }),
    pull.asyncMap((_, cb) => {
      ssb.db.publish(
        { type: 'post', text: 'B: 2nd', root: rootAkey.toLowerCase() },
        wait(cb, 800),
      );
    }),
    pull.asyncMap((_, cb) => {
      ssb.db.publish(
        { type: 'post', text: 'A: 3rd', root: rootAkey },
        wait(cb, 800),
      );
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

test('threads.public respects following opt', (t) => {
  const ssb = Testbot({ keys: lucyKeys });

  pull(
    pullAsync((cb) => {
      ssb.db.publish(
        { type: 'contact', contact: maryKeys.id, following: true },
        wait(cb, 800),
      );
    }),
    pull.asyncMap((_, cb) => {
      ssb.db.create(
        {
          keys: maryKeys,
          content: { type: 'post', text: 'Root post from Mary' },
        },
        wait(cb, 800),
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
        wait(cb, 800),
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
    pull.map(() => ssb.threads.public({ following: true })),
    pull.flatten(),

    pull.collect((err, threads) => {
      t.error(err);
      t.equals(threads.length, 2);

      const onlyFollowingThreads = threads.every((t) => {
        const threadRootMsg = t.messages.find(
          (m) => m.value.content.root === undefined,
        );
        return threadRootMsg.key !== aliceKeys.id;
      });

      t.ok(onlyFollowingThreads, 'only threads created by following returned');

      const maryThread = threads.find(
        (t) =>
          !!t.messages.find(
            (m) =>
              m.value.content.root === undefined &&
              m.value.author === maryKeys.id,
          ),
      );
      const maryThreadRoot = maryThread.messages.find(
        (m) => m.value.content.root === undefined,
      );
      const maryThreadReplies = maryThread.messages.filter(
        (m) => !!m.value.content.root,
      );

      t.equals(maryThreadReplies.length, 1);
      t.equals(
        maryThreadReplies[0].value.author,
        aliceKeys.id,
        'Replies to following root from non-following are preserved',
      );

      ssb.close(t.end);
    }),
  );
});

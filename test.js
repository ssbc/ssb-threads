var test = require('tape');
var pull = require('pull-stream');
var ssbKeys = require('ssb-keys');
var pullAsync = require('pull-async');
var CreateTestSbot = require('scuttle-testbot').use(require('./lib/index'));

var lucyKeys = ssbKeys.generate();

test('gives a simple well-formed thread', function(t) {
  var myTestSbot = CreateTestSbot({ name: 'test1', keys: lucyKeys });

  var lucy = myTestSbot.createFeed(lucyKeys);

  pull(
    pullAsync(cb => {
      lucy.add({ type: 'post', text: 'Thread root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      lucy.add({ type: 'post', text: 'Second message', root: rootMsg.key }, cb);
    }),
    pull.asyncMap((prevMsg, cb) => {
      var rootKey = prevMsg.value.content.root;
      lucy.add({ type: 'post', text: 'Third message', root: rootKey }, cb);
    }),
    pull.map(prevMsg => myTestSbot.threads.public({})),
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

test('respects threadMaxSize opt', function(t) {
  var myTestSbot = CreateTestSbot({ name: 'test2', keys: lucyKeys });

  var lucy = myTestSbot.createFeed(lucyKeys);

  pull(
    pullAsync(cb => {
      lucy.add({ type: 'post', text: 'Thread root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      lucy.add({ type: 'post', text: 'Second message', root: rootMsg.key }, cb);
    }),
    pull.asyncMap((prevMsg, cb) => {
      var rootKey = prevMsg.value.content.root;
      lucy.add({ type: 'post', text: 'Third message', root: rootKey }, cb);
    }),
    pull.map(prevMsg => myTestSbot.threads.public({ threadMaxSize: 2 })),
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

test('respects whitelist opt', function(t) {
  var myTestSbot = CreateTestSbot({ name: 'test3', keys: lucyKeys });

  var lucy = myTestSbot.createFeed(lucyKeys);

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
    pull.asyncMap((prevMsg, cb) => {
      lucy.add({ type: 'shout', text: 'AAAHHH' }, cb);
    }),
    pull.map(prevMsg => myTestSbot.threads.public({ whitelist: ['shout'] })),
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

test('respects blacklist opt', function(t) {
  var myTestSbot = CreateTestSbot({ name: 'test4', keys: lucyKeys });

  var lucy = myTestSbot.createFeed(lucyKeys);

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
    pull.asyncMap((prevMsg, cb) => {
      lucy.add({ type: 'shout', text: 'AAAHHH' }, cb);
    }),
    pull.map(prevMsg =>
      myTestSbot.threads.public({ blacklist: ['shout', 'vote'] }),
    ),
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

test('gives multiple threads', function(t) {
  var myTestSbot = CreateTestSbot({ name: 'test5', keys: lucyKeys });

  var lucy = myTestSbot.createFeed(lucyKeys);

  let rootAkey;
  pull(
    pullAsync(cb => {
      lucy.add({ type: 'post', text: 'A: root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      rootAkey = rootMsg;
      lucy.add({ type: 'post', text: 'A: 2nd', root: rootMsg.key }, cb);
    }),
    pull.asyncMap((prevMsg, cb) => {
      var rootKey = prevMsg.value.content.root;
      lucy.add({ type: 'post', text: 'A: 3rd', root: rootKey }, cb);
    }),
    pull.asyncMap((_, cb) => {
      lucy.add({ type: 'post', text: 'B: root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      lucy.add({ type: 'post', text: 'B: 2nd', root: rootMsg.key }, cb);
    }),

    pull.map(prevMsg => myTestSbot.threads.public({ reverse: true })),
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

test('sorts threads by recency', function(t) {
  var myTestSbot = CreateTestSbot({ name: 'test5', keys: lucyKeys });

  var lucy = myTestSbot.createFeed(lucyKeys);

  let rootAkey;
  pull(
    pullAsync(cb => {
      lucy.add({ type: 'post', text: 'A: root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      rootAkey = rootMsg;
      lucy.add({ type: 'post', text: 'A: 2nd', root: rootMsg.key }, cb);
    }),
    pull.asyncMap((_, cb) => {
      lucy.add({ type: 'post', text: 'B: root' }, cb);
    }),
    pull.asyncMap((rootMsg, cb) => {
      lucy.add({ type: 'post', text: 'B: 2nd', root: rootMsg.key }, cb);
    }),
    pull.asyncMap((_, cb) => {
      lucy.add({ type: 'post', text: 'A: 3rd', root: rootAkey.key }, cb);
    }),

    pull.map(prevMsg => myTestSbot.threads.public({ reverse: true })),
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

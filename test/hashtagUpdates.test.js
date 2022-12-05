const test = require('tape');
const pull = require('pull-stream');
const ssbKeys = require('ssb-keys');
const p = require('util').promisify;
const Testbot = require('./testbot');

const lucyKeys = ssbKeys.generate(null, 'lucy');

test('threads.hashtagUpdates notifies of new thread', async (t) => {
  const ssb = Testbot({ keys: lucyKeys });

  let actual = [];
  let liveDrainer;
  pull(
    ssb.threads.hashtagUpdates({ hashtags: ['food', 'animals'] }),
    (liveDrainer = pull.drain((msgId) => {
      actual.push(msgId);
    })),
  );
  t.pass('listening to live stream');

  const animalMsg = await p(ssb.db.publish)({
    type: 'post',
    text: 'Dog',
    mentions: [{ link: '#animals' }],
  });
  t.pass('published animalMsg');
  await p(setTimeout)(800);

  await p(ssb.db.publish)({
    type: 'post',
    text: 'Ferrari',
    channel: 'cars',
  });
  t.pass('published carMsg');
  await p(setTimeout)(800);

  const foodMsg = await p(ssb.db.publish)({
    type: 'post',
    text: 'Pizza',
    mentions: [{ link: '#food' }],
  });
  t.pass('published foodMsg');
  await p(setTimeout)(800);

  t.equals(actual.length, 2);
  const [msgId1, msgId2] = actual;
  t.equals(msgId1, animalMsg.key);
  t.equals(msgId2, foodMsg.key);

  liveDrainer.abort();

  await p(ssb.close)();
});

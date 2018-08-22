# ssb-threads

> A Scuttlebot plugin for fetching messages as threads

## Usage

Requires the backlinks plugin.

```diff
 const createSbot = require('scuttlebot/index')
   .use(require('scuttlebot/plugins/plugins'))
   .use(require('scuttlebot/plugins/master'))
   .use(require('scuttlebot/plugins/gossip'))
   .use(require('scuttlebot/plugins/replicate'))
   .use(require('ssb-friends'))
   .use(require('ssb-blobs'))
+  .use(require('ssb-backlinks'))
   .use(require('ssb-private'))
   .use(require('ssb-about'))
   .use(require('ssb-contacts'))
   .use(require('ssb-query'))
+  .use(require('ssb-threads'))
   .use(require('scuttlebot/plugins/invite'))
   .use(require('scuttlebot/plugins/block'))
   .use(require('scuttlebot/plugins/local'))
```

```js
pull(
  sbot.threads.public({
    limit: 10, // how many threads at most
    reverse: true, // threads sorted from most recent to least recent
    threadMaxSize: 3, // at most 3 messages in each thread
  }),
  pull.drain(thread => {
    console.log(thread);
    // thread is an object { messages, full } where `messages` is an
    // array of SSB messages, and full is a boolean indicating whether
    // `messages` array contains all of the possible messages in the
    // thread
  }),
);
```

## API

### `sbot.threads.public(opts)`

Returns a pull stream that emits thread objects of public messages.

* `opts.reverse`: boolean
* `opts.limit`: optional number (default: Infinity). Dictates the maximum amount of
  threads this pull stream will return
* `opts.threadMaxSize`: optional number (default: Infinity). Dictates the maximum amount of messages in each returned thread object. Serves for previewing threads, particularly long ones.
* `opts.allowlist`: optional array of strings. Dictates which messages **types** to allow as root messages, while forbidding other types.
* `opts.blocklist`: optional array of strings. Dictates which messages **types** to forbid as root messages, while allowing other types.

### `sbot.threads.publicUpdates(opts)`

Returns a ("live") pull stream that emits a message key (strings) for every new message that passes the (optional) allowlist or blocklist.

* `opts.allowlist`: optional array of strings. Dictates which messages **types** to allow as root messages, while forbidding other types.
* `opts.blocklist`: optional array of strings. Dictates which messages **types** to forbid as root messages, while allowing other types.

### `sbot.threads.profile(opts)`

Returns a pull stream that emits thread objects of public messages initiated by a certain profile `id`.

* `opts.id`: FeedId of some SSB user.
* `opts.reverse`: boolean.
* `opts.limit`: optional number (default: Infinity). Dictates the maximum amount of
  threads this pull stream will return
* `opts.threadMaxSize`: optional number (default: Infinity). Dictates the maximum amount of messages in each returned thread object. Serves for previewing threads, particularly long ones.
* `opts.allowlist`: optional array of strings. Dictates which messages **types** to allow as root messages, while forbidding other types.
* `opts.blocklist`: optional array of strings. Dictates which messages **types** to forbid as root messages, while allowing other types.

### `sbot.threads.thread(opts)`

Returns a pull stream that emits one thread object of messages under the root identified by `opts.root` (MsgId).

* `opts.root`: a MsgId that identifies the root of the thread.
* `opts.threadMaxSize`: optional number (default: Infinity). Dictates the maximum amount of messages in each returned thread object. Serves for previewing threads, particularly long ones.

## Install

```
npm install --save ssb-threads
```

## License

MIT

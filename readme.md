# ssb-threads

> A Scuttlebot plugin for fetching messages as threads

## Usage

**Requires the backlinks plugin.** If the **ssb-friends** plugin is available it will filter the messages of blocked users.

```diff
 SecretStack({appKey: require('ssb-caps').shs})
   .use(require('ssb-master'))
   .use(require('ssb-db'))
   .use(require('ssb-replicate'))
   .use(require('ssb-lan'))
   .use(require('ssb-conn'))
+  .use(require('ssb-backlinks'))
   .use(require('ssb-friends'))
   .use(require('ssb-private'))
+  .use(require('ssb-threads'))
   .use(require('ssb-blobs'))
   .use(require('ssb-invite'))
   .call(null, config)
```

```js
pull(
  ssb.threads.public({
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

### `ssb.threads.public(opts)`

Returns a pull stream that emits thread objects of public messages.

* `opts.reverse`: boolean
* `opts.limit`: optional number (default: Infinity). Dictates the maximum amount of
  threads this pull stream will return
* `opts.threadMaxSize`: optional number (default: Infinity). Dictates the maximum amount of messages in each returned thread object. Serves for previewing threads, particularly long ones.
* `opts.allowlist`: optional array of strings. Dictates which messages **types** to allow as root messages, while forbidding other types.
* `opts.blocklist`: optional array of strings. Dictates which messages **types** to forbid as root messages, while allowing other types.

### `ssb.threads.publicUpdates(opts)`

Returns a ("live") pull stream that emits a message key (strings) for every new message that passes the (optional) allowlist or blocklist.

* `opts.allowlist`: optional array of strings. Dictates which messages **types** to allow as root messages, while forbidding other types.
* `opts.blocklist`: optional array of strings. Dictates which messages **types** to forbid as root messages, while allowing other types.

### `ssb.threads.private(opts)`

**Requires the **ssb-private** plugin to be installed.**

Returns a pull stream that emits thread objects of private conversations.

* `opts.reverse`: boolean
* `opts.limit`: optional number (default: Infinity). Dictates the maximum amount of
  threads this pull stream will return
* `opts.threadMaxSize`: optional number (default: Infinity). Dictates the maximum amount of messages in each returned thread object. Serves for previewing threads, particularly long ones.
* `opts.allowlist`: optional array of strings. Dictates which messages **types** to allow as root messages, while forbidding other types.
* `opts.blocklist`: optional array of strings. Dictates which messages **types** to forbid as root messages, while allowing other types.

### `ssb.threads.profile(opts)`

Returns a pull stream that emits thread objects of public messages initiated by a certain profile `id`.

* `opts.id`: FeedId of some SSB user.
* `opts.reverse`: boolean.
* `opts.limit`: optional number (default: Infinity). Dictates the maximum amount of
  threads this pull stream will return
* `opts.threadMaxSize`: optional number (default: Infinity). Dictates the maximum amount of messages in each returned thread object. Serves for previewing threads, particularly long ones.
* `opts.allowlist`: optional array of strings. Dictates which messages **types** to allow as root messages, while forbidding other types.
* `opts.blocklist`: optional array of strings. Dictates which messages **types** to forbid as root messages, while allowing other types.

### `ssb.threads.thread(opts)`

Returns a pull stream that emits one thread object of messages under the root identified by `opts.root` (MsgId).

* `opts.root`: a MsgId that identifies the root of the thread.
* `opts.threadMaxSize`: optional number (default: Infinity). Dictates the maximum amount of messages in each returned thread object. Serves for previewing threads, particularly long ones.
* `opts.allowlist`: optional array of strings. Dictates which messages **types** to allow as root messages, while forbidding other types.
* `opts.blocklist`: optional array of strings. Dictates which messages **types** to forbid as root messages, while allowing other types.

If `opts.allowlist` and `opts.blocklist` are not defined,
only messages of type **post** will be returned.

**If the `opts.root` is an encrypted message, this will attempt to unbox the message, and if that succeeds, then all of the replies in this thread will be also unboxed. ⚠️ Warning: this is why you should only use this method locally and not allow remote peers to call `ssb.threads.thread`, you don't want them to see your encrypted messages.**

### `ssb.threads.threadUpdates(opts)`

Returns a ("live") pull stream that emits every new message which is a reply to this thread, and which passes the (optional) allowlist or blocklist.

* `opts.root`: a MesgId that identifies the root of the thread.
* `opts.allowlist`: optional array of strings. Dictates which messages **types** to allow as root messages, while forbidding other types.
* `opts.blocklist`: optional array of strings. Dictates which messages **types** to forbid as root messages, while allowing other types.

**If the `opts.root` is an encrypted message, this will attempt to unbox the incoming replies. ⚠️ Warning: this is why you should only use this method locally and not allow remote peers to call `ssb.threads.threadUpdates`, you don't want them to see your encrypted messages.**

## Install

```
npm install --save ssb-threads
```

## License

MIT

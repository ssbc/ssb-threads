import { Msg, MsgId } from 'ssb-typescript';
import {
  Opts,
  Thread,
  ProfileOpts,
  ThreadOpts,
  UpdatesOpts,
  FilterOpts,
} from './types';
const pull = require('pull-stream');
const cat = require('pull-cat');
const FlumeViewLevel = require('flumeview-level');
const sort = require('ssb-sort');
const ssbRef = require('ssb-ref');
const QuickLRU = require('quick-lru');

type Filter = (msg: Msg) => boolean;
type IndexItem = [string, number, MsgId];

function getTimestamp(msg: Msg<any>): number {
  const arrivalTimestamp = msg.timestamp;
  const declaredTimestamp = msg.value.timestamp;
  return Math.min(arrivalTimestamp, declaredTimestamp);
}

function getRootMsgId(msg: Msg<any>): MsgId | undefined {
  if (msg && msg.value && msg.value.content) {
    const root = msg.value.content.root;
    if (ssbRef.isMsgId(root)) return root;
  }
}

function buildPublicIndex(ssb: any) {
  return ssb._flumeUse(
    'threads-public',
    FlumeViewLevel(2, (msg: Msg, _seq: number) => [
      ['any', getTimestamp(msg), getRootMsgId(msg) || msg.key],
    ]),
  );
}

function buildProfilesIndex(ssb: any) {
  return ssb._flumeUse(
    'threads-profiles',
    FlumeViewLevel(2, (msg: Msg, _seq: number) => [
      [msg.value.author, getTimestamp(msg), getRootMsgId(msg) || msg.key],
    ]),
  );
}

function isValidIndexItem(item: any) {
  return !!item && !!item[2];
}

function isUnique(uniqueRoots: Set<MsgId>) {
  return function checkIsUnique(item: IndexItem) {
    const rootKey = item[2];
    if (uniqueRoots.has(rootKey)) {
      return false;
    } else {
      uniqueRoots.add(rootKey);
      return true;
    }
  };
}

function isPublic(msg: Msg<any>): boolean {
  return !msg.value.content || typeof msg.value.content !== 'string';
}

function isNotMine(sbot: any) {
  return function isNotMineGivenSbot(msg: Msg<any>): boolean {
    return msg && msg.value && msg.value.author !== sbot.id;
  };
}

function materialize(sbot: any, cache: Map<MsgId, Msg<any>>) {
  function sbotGetWithCache(item: IndexItem, cb: (e: any, msg?: Msg) => void) {
    const [, timestamp, key] = item;
    if (cache.has(key)) {
      cb(null, cache.get(key) as Msg);
    } else {
      sbot.get(key, (err: any, value: Msg['value']) => {
        if (err) return cb(err);
        var msg = { key, value, timestamp };
        if (msg.value) cache.set(key, msg);
        cb(null, msg);
      });
    }
  }

  return function fetchMsg(
    item: IndexItem,
    cb: (err: any, msg?: Msg | false) => void,
  ) {
    sbotGetWithCache(item, (err, msg) => {
      if (err) return cb(null, false);
      cb(null, msg);
    });
  };
}

function hasRoot(rootKey: MsgId) {
  return (msg: Msg<{ root?: MsgId }>) =>
    msg &&
    msg.value &&
    msg.value.content &&
    msg.value.content.root &&
    msg.value.content.root === rootKey;
}

function makeAllowFilter(list: Array<string> | undefined) {
  return (msg: Msg) =>
    !list ||
    ((msg &&
      msg.value &&
      msg.value.content &&
      msg.value.content.type &&
      list.indexOf(msg.value.content.type) > -1) as boolean);
}

function makeBlockFilter(list: Array<string> | undefined) {
  return (msg: Msg) =>
    !list ||
    (!(
      msg &&
      msg.value &&
      msg.value.content &&
      msg.value.content.type &&
      list.indexOf(msg.value.content.type) > -1
    ) as boolean);
}

function removeMessagesFromBlocked(sbot: any) {
  return (inputPullStream: any) =>
    pull(
      inputPullStream,
      pull.asyncMap((msg: Msg, cb: (e: any, done?: Msg | null) => void) => {
        sbot.friends.isBlocking(
          { source: sbot.id, dest: msg.value.author },
          (err: any, blocking: boolean) => {
            if (err) cb(err);
            else if (blocking) cb(null, null);
            else cb(null, msg);
          },
        );
      }),
      pull.filter(),
    );
}

function makeFilter(opts: FilterOpts): (msg: Msg) => boolean {
  const passesAllowList = makeAllowFilter(opts.allowlist);
  const passesBlockList = makeBlockFilter(opts.blocklist);
  return (m: Msg) => passesAllowList(m) && passesBlockList(m);
}

function nonBlockedRootToThread(sbot: any, maxSize: number, filter: Filter) {
  return (root: Msg, cb: (err: any, thread?: Thread) => void) => {
    pull(
      cat([
        pull.values([root]),
        pull(
          sbot.backlinks.read({
            query: [{ $filter: { dest: root.key } }],
            index: 'DTA',
            live: false,
            reverse: true,
          }),
          pull.filter(hasRoot(root.key)),
          removeMessagesFromBlocked(sbot),
          pull.filter(filter),
          pull.take(maxSize),
        ),
      ]),
      pull.take(maxSize + 1),
      pull.collect((err2: any, arr: Array<Msg>) => {
        if (err2) return cb(err2);
        const full = arr.length <= maxSize;
        sort(arr);
        if (arr.length > maxSize && arr.length >= 3) arr.splice(1, 1);
        cb(null, { messages: arr, full });
      }),
    );
  };
}

function rootToThread(sbot: any, maxSize: number, filter: Filter) {
  return (root: Msg, cb: (err: any, thread?: Thread) => void) => {
    sbot.friends.isBlocking(
      { source: sbot.id, dest: root.value.author },
      (err: any, blocking: boolean) => {
        if (err) cb(err);
        else if (blocking) cb(new Error('Author Blocked:' + root.value.author));
        else nonBlockedRootToThread(sbot, maxSize, filter)(root, cb);
      },
    );
  };
}

function init(sbot: any, _config: any) {
  if (!sbot.backlinks || !sbot.backlinks.read) {
    throw new Error('"ssb-threads" is missing required plugin "ssb-backlinks"');
  }
  if (!sbot.friends || !sbot.friends.isBlocking) {
    throw new Error('"ssb-threads" is missing required plugin "ssb-friends@3"');
  }
  const publicIndex = buildPublicIndex(sbot);
  const profilesIndex = buildProfilesIndex(sbot);

  return {
    public: function _public(opts: Opts) {
      const lt = opts.lt;
      const reverse = opts.reverse === false ? false : true;
      const live = opts.live === true ? true : false;
      const maxThreads = opts.limit || Infinity;
      const threadMaxSize = opts.threadMaxSize || Infinity;
      const filter = makeFilter(opts);

      return pull(
        publicIndex.read({
          lt: ['any', lt, undefined],
          reverse,
          live,
          keys: true,
          values: false,
          seqs: false,
        }),
        pull.filter(isValidIndexItem),
        pull.filter(isUnique(new Set())),
        pull.asyncMap(materialize(sbot, new QuickLRU({ maxSize: 200 }))),
        pull.filter((x: Msg | false) => x !== false),
        pull.filter(isPublic),
        removeMessagesFromBlocked(sbot),
        pull.filter(filter),
        pull.take(maxThreads),
        pull.asyncMap(nonBlockedRootToThread(sbot, threadMaxSize, filter)),
      );
    },

    publicUpdates: function _publicUpdates(opts: UpdatesOpts) {
      const filter = makeFilter(opts);

      return pull(
        sbot.createFeedStream({ reverse: false, old: false, live: true }),
        pull.filter(isNotMine(sbot)),
        pull.filter(isPublic),
        removeMessagesFromBlocked(sbot),
        pull.filter(filter),
        pull.map((msg: Msg) => msg.key),
      );
    },

    profile: function _profile(opts: ProfileOpts) {
      const id = opts.id;
      const lt = opts.lt;
      const reverse = opts.reverse === false ? false : true;
      const live = opts.live === true ? true : false;
      const maxThreads = opts.limit || Infinity;
      const threadMaxSize = opts.threadMaxSize || Infinity;
      const filter = makeFilter(opts);

      return pull(
        profilesIndex.read({
          lt: [id, lt, undefined],
          gt: [id, null, undefined],
          reverse,
          live,
          keys: true,
          values: false,
          seqs: false,
        }),
        pull.filter(isValidIndexItem),
        pull.filter(isUnique(new Set())),
        pull.asyncMap(materialize(sbot, new QuickLRU({ maxSize: 200 }))),
        pull.filter((x: Msg | false) => x !== false),
        pull.filter(isPublic),
        removeMessagesFromBlocked(sbot),
        pull.filter(filter),
        pull.take(maxThreads),
        pull.asyncMap(nonBlockedRootToThread(sbot, threadMaxSize, filter)),
      );
    },

    thread: function _thread(opts: ThreadOpts) {
      const threadMaxSize = opts.threadMaxSize || Infinity;
      const rootToMsg = (val: Msg['value']): Msg => ({
        key: opts.root,
        value: val,
        timestamp: val.timestamp,
      });
      const filterPosts = makeAllowFilter(['post']);

      return pull(
        pull.values([opts.root]),
        pull.asyncMap(sbot.get.bind(sbot)),
        pull.map(rootToMsg),
        pull.asyncMap(rootToThread(sbot, threadMaxSize, filterPosts)),
      );
    },
  };
}

export = {
  name: 'threads',
  version: '2.0.0',
  manifest: {
    public: 'source',
    publicUpdates: 'source',
    profile: 'source',
    thread: 'source',
  },
  permissions: {
    master: {
      allow: ['public', 'profile', 'thread'],
    },
  },
  init,
};

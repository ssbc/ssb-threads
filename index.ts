import { Msg, MsgId } from 'ssb-typescript';
import { Opts, ThreadData, ProfileOpts, ThreadOpts } from './types';
const pull = require('pull-stream');
const cat = require('pull-cat');
const sort = require('ssb-sort');
const ssbRef = require('ssb-ref');
const QuickLRU = require('quick-lru');

type ProcessingOpts = {
  lt: number;
  ssb: any;
  recencyMap: Map<MsgId, number>;
};

function getRootMsgId(msg: Msg<any>): MsgId | undefined {
  if (msg && msg.value && msg.value.content) {
    const root = msg.value.content.root;
    if (ssbRef.isMsgId(root)) return root;
  }
}

function isPublic(msg: Msg<any>): boolean {
  return !msg.value.content || typeof msg.value.content !== 'string';
}

function rootToThread(sbot: any, threadMaxSize: number) {
  return (root: Msg, cb: (err: any, thread?: ThreadData) => void) => {
    pull(
      cat([
        pull.values([root]),
        sbot.links({
          rel: 'root',
          dest: root.key,
          limit: threadMaxSize,
          reverse: true,
          live: false,
          keys: true,
          values: true,
        }),
      ]),
      pull.take(threadMaxSize + 1),
      pull.collect((err2: any, arr: Array<Msg>) => {
        if (err2) return cb(err2);
        const full = arr.length <= threadMaxSize;
        sort(arr);
        if (arr.length > threadMaxSize && arr.length >= 3) arr.splice(1, 1);
        cb(null, { messages: arr, full });
      }),
    );
  };
}

function processNextMsg(readMsg: any, opts: ProcessingOpts, cb: any) {
  const { ssb, recencyMap } = opts;
  readMsg(null, (end: any, msg: Msg) => {
    // Gate for errors or aborts
    if (end === true) {
      cb(true);
      return;
    } else if (end) {
      cb(end);
      return;
    }

    const rootMsgId: MsgId = getRootMsgId(msg) || msg.key;
    const isRoot = msg.key === rootMsgId;

    // Update recency
    const alreadyProcessedRoot = recencyMap.has(rootMsgId);
    let recency = recencyMap.get(rootMsgId);
    if (!recency || msg.value.timestamp > recency) {
      recency = msg.value.timestamp;
      recencyMap.set(rootMsgId, recency);
    }

    // Gate against repeating roots
    if (alreadyProcessedRoot) {
      processNextMsg(readMsg, opts, cb);
      return;
    }

    // Gate against invalid recencies
    if (recency > opts.lt) {
      processNextMsg(readMsg, opts, cb);
      return;
    }

    // Add root
    if (isRoot) {
      cb(null, msg);
    } else {
      ssb.get(rootMsgId, (err1: any, value: Msg['value']) => {
        if (err1) {
          processNextMsg(readMsg, opts, cb);
          return;
        }
        const rootMsg = { key: rootMsgId, value, timestamp: 0 };
        cb(null, rootMsg);
      });
    }
  });
}

function uniqueRoots(opts: ProcessingOpts) {
  return function inputReader(readInput: any) {
    const processingOpts = { ...opts };
    return function outputReadable(abort: any, cb: any) {
      if (abort) return cb(abort);
      processNextMsg(readInput, processingOpts, cb);
    };
  };
}

function makeWhitelistFilter(list: Array<string> | undefined) {
  return (msg: Msg) =>
    !list ||
    (msg &&
      msg.value &&
      msg.value.content &&
      msg.value.content.type &&
      list.indexOf(msg.value.content.type) > -1);
}

function makeBlacklistFilter(list: Array<string> | undefined) {
  return (msg: Msg) =>
    !list ||
    !(
      msg &&
      msg.value &&
      msg.value.content &&
      msg.value.content.type &&
      list.indexOf(msg.value.content.type) > -1
    );
}

function init(ssb: any, config: any) {
  const recencyMap = new QuickLRU({ maxSize: 200 });

  return {
    public: function _public(opts: Opts) {
      const lt = opts.lt || Infinity;
      const maxThreads = opts.limit || Infinity;
      const threadMaxSize = opts.threadMaxSize || Infinity;
      const passesWhitelist = makeWhitelistFilter(opts.whitelist);
      const passesBlacklist = makeBlacklistFilter(opts.blacklist);

      return pull(
        ssb.createFeedStream({ ...opts, limit: undefined, live: false }),
        uniqueRoots({ ssb, recencyMap, lt }),
        pull.filter(isPublic),
        pull.filter(passesWhitelist),
        pull.filter(passesBlacklist),
        pull.take(maxThreads),
        pull.asyncMap(rootToThread(ssb, threadMaxSize)),
      );
    },

    profile: function _profile(opts: ProfileOpts) {
      const id = opts.id;
      const lt = opts.lt || Infinity;
      const maxThreads = opts.limit || Infinity;
      const threadMaxSize = opts.threadMaxSize || Infinity;
      const passesWhitelist = makeWhitelistFilter(opts.whitelist);
      const passesBlacklist = makeBlacklistFilter(opts.blacklist);

      return pull(
        ssb.createUserStream({ ...opts, limit: undefined, live: false, id }),
        uniqueRoots({ ssb, recencyMap, lt }),
        pull.filter(isPublic),
        pull.filter(passesWhitelist),
        pull.filter(passesBlacklist),
        pull.take(maxThreads),
        pull.asyncMap(rootToThread(ssb, threadMaxSize)),
      );
    },

    thread: function _thread(opts: ThreadOpts) {
      const threadMaxSize = opts.threadMaxSize || Infinity;
      const rootToMsg = (val: Msg['value']): Msg => ({
        key: opts.root,
        value: val,
        timestamp: val.timestamp,
      });

      return pull(
        pull.values([opts.root]),
        pull.asyncMap(ssb.get.bind(ssb)),
        pull.map(rootToMsg),
        pull.asyncMap(rootToThread(ssb, threadMaxSize)),
      );
    },
  };
}

export = {
  name: 'threads',
  version: '1.1.0',
  manifest: {
    public: 'source',
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

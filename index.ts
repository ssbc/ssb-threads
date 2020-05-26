import { Msg, MsgId, UnboxedMsg } from 'ssb-typescript';
import {
  isPublic,
  isPrivate,
  isRootMsg,
  isIndirectReplyMsgToRoot
} from 'ssb-typescript/utils';
import { plugin, muxrpc } from 'secret-stack-decorators';
import QuickLRU = require('quick-lru');
import {
  Opts,
  Thread,
  ProfileOpts,
  ThreadOpts,
  UpdatesOpts,
  FilterOpts,
  ThreadUpdatesOpts,
} from './types';
const pull = require('pull-stream');
const cat = require('pull-cat');
const FlumeViewLevel = require('flumeview-level');
const sort = require('ssb-sort');
const Ref = require('ssb-ref');

type CB<T> = (err: any, val?: T) => void;
type Filter = (msg: Msg) => boolean;
type IndexItem = [
  /* prefix label */ string,
  /* timestamp */ number,
  /* root msg key */ MsgId,
];

/**
 * The average SSB message in JSON is about 0.5 KB — 1.5 KB in size.
 * 800 of these are then roughly 1 MB. This should be a reasonable
 * cost in RAM for the added benefit of lookup speed for 2010+ hardware.
 */
const REASONABLE_CACHE_SIZE = 800;

const IS_BLOCKING_NEVER = (obj: any, cb: CB<boolean>) => {
  cb(null, false);
};

function getTimestamp(msg: Msg<any>): number {
  const arrivalTimestamp = msg.timestamp;
  const declaredTimestamp = msg.value.timestamp;
  return Math.min(arrivalTimestamp, declaredTimestamp);
}

function getRootMsgId(msg: Msg<any>): MsgId {
  if (msg?.value?.content) {
    const branch = msg.value.content.fork;
    const fork = msg.value.content.fork;
    const root = msg.value.content.root;
    if (branch && Ref.isMsgId(branch)) return branch;
    if (fork && Ref.isMsgId(fork)) return fork;
    if (root && Ref.isMsgId(root)) return root;
  }
  return msg.key; // this msg has no root so we assume this is a root
}

function isValidIndexItem(item: Array<any>) {
  return !!item?.[2];
}

function isUniqueRootInIndexItem(uniqueRoots: Set<MsgId>) {
  return function checkIsUnique_index(item: IndexItem) {
    const [, , rootKey] = item;
    if (uniqueRoots.has(rootKey)) {
      return false;
    } else {
      uniqueRoots.add(rootKey);
      return true;
    }
  };
}

function isUniqueMsgId(uniqueRoots: Set<MsgId>) {
  return function checkIsUnique_id(id: MsgId) {
    if (uniqueRoots.has(id)) {
      return false;
    } else {
      uniqueRoots.add(id);
      return true;
    }
  };
}

function makeAllowFilter(list: Array<string> | undefined) {
  return (msg: Msg) =>
    !list ||
    ((msg?.value?.content?.type &&
      list.indexOf(msg.value.content.type) > -1) as boolean);
}

function makeBlockFilter(list: Array<string> | undefined) {
  return (msg: Msg) =>
    !list ||
    (!(
      msg?.value?.content?.type && list.indexOf(msg.value.content.type) > -1
    ) as boolean);
}

function makeFilter(opts: FilterOpts): (msg: Msg) => boolean {
  const passesAllowList = makeAllowFilter(opts.allowlist);
  const passesBlockList = makeBlockFilter(opts.blocklist);
  return (m: Msg) => passesAllowList(m) && passesBlockList(m);
}

@plugin('2.0.0')
class threads {
  private readonly ssb: Record<string, any>;
  private readonly isBlocking: (obj: any, cb: CB<boolean>) => void;
  private readonly msgCache: QuickLRU<MsgId, Msg<any>>;
  private readonly supportsPrivate: boolean;
  private readonly publicIndex: { read: CallableFunction };
  private readonly profilesIndex: { read: CallableFunction };

  constructor(ssb: Record<string, any>, _config: any) {
    if (!ssb.backlinks?.read) {
      throw new Error(
        '"ssb-threads" is missing required plugin "ssb-backlinks"',
      );
    }

    this.ssb = ssb;
    this.isBlocking = ssb.friends?.isBlocking
      ? ssb.friends.isBlocking
      : IS_BLOCKING_NEVER;
    this.msgCache = new QuickLRU({ maxSize: REASONABLE_CACHE_SIZE });
    this.supportsPrivate = !!ssb.private?.read && !!ssb.private?.unbox;
    this.publicIndex = this.buildPublicIndex();
    this.profilesIndex = this.buildProfilesIndex();
  }

  //#region PRIVATE

  private buildPublicIndex() {
    return this.ssb._flumeUse(
      'threads-public',
      FlumeViewLevel(2, (m: Msg, _seq: number) =>
        isPublic(m)
          ? [['any', getTimestamp(m), getRootMsgId(m)] as IndexItem]
          : [],
      ),
    );
  }

  private buildProfilesIndex() {
    return this.ssb._flumeUse(
      'threads-profiles',
      FlumeViewLevel(2, (m: Msg, _seq: number) =>
        isPublic(m)
          ? [[m.value.author, getTimestamp(m), getRootMsgId(m)] as IndexItem]
          : [],
      ),
    );
  }

  private isNotMine = (msg: Msg<any>): boolean => {
    return msg?.value?.author !== this.ssb.id;
  };

  private removeMessagesFromBlocked = (source: any) =>
    pull(
      source,
      pull.asyncMap((msg: Msg, cb: CB<Msg | null>) => {
        this.isBlocking(
          { source: this.ssb.id, dest: msg.value.author },
          (err: any, blocking: boolean) => {
            if (err) cb(err);
            else if (blocking) cb(null, null);
            else cb(null, msg);
          },
        );
      }),
      pull.filter(),
    );

  private nonBlockedRootToThread = (
    maxSize: number,
    filter: Filter,
    privately: boolean = false,
  ) => {
    return (root: Msg, cb: CB<Thread>) => {
      pull(
        cat([
          pull.values([root]),
          pull(
            this.ssb.backlinks.read({
              query: [{ $filter: { dest: root.key } }],
              index: 'DTA',
              private: privately,
              live: false,
              reverse: true,
            }),
            pull.filter(isIndirectReplyMsgToRoot(root.key)),
            this.removeMessagesFromBlocked,
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
  };

  // TODO refactor: the two methods below share a lot of code in common

  /**
   * Returns a pull-stream operator pipeline that:
   * 1. Picks the MsgId from the source IndexItem
   * 2. Checks if there is a Msg in the cache for that id, and returns that
   * 3. If not in the cache, do a database lookup
   * 4. If an error occurs when looking up the database, ignore the error
   */
  private fetchRootMsgFromIndexItem = (source: any) =>
    pull(
      source,
      pull.asyncMap((item: IndexItem, cb: CB<Msg<any> | false>) => {
        const [, , id] = item;
        if (this.msgCache.has(id)) {
          cb(null, this.msgCache.get(id)!);
        } else {
          this.ssb.get({ id, meta: true }, (err: any, msg: Msg<any>) => {
            if (err) return cb(null, false);
            if (msg.value) this.msgCache.set(id, msg);
            cb(null, msg);
          });
        }
      }),
      pull.filter((x: Msg | false) => x !== false),
    );

  /**
   * Returns a pull-stream operator that:
   * 1. Checks if there is a Msg in the cache for the source MsgId
   * 2. If not in the cache, do a database lookup
   */
  private fetchMsgFromId = (source: any) =>
    pull(
      source,
      pull.asyncMap((id: MsgId, cb: CB<Msg<any>>) => {
        if (this.msgCache.has(id)) {
          cb(null, this.msgCache.get(id)!);
        } else {
          this.ssb.get({ id, meta: true }, (err: any, msg: Msg<any>) => {
            if (err) return cb(err);
            if (msg.value) this.msgCache.set(id, msg);
            cb(null, msg);
          });
        }
      }),
    );

  private maybeUnboxMsg = (msg: Msg): Msg | UnboxedMsg => {
    if (typeof msg.value.content !== 'string') return msg;
    if (!this.supportsPrivate) {
      throw new Error('"ssb-threads" is missing required plugin "ssb-private"');
    }

    return this.ssb.private?.unbox(msg);
  };

  private rootToThread = (
    maxSize: number,
    filter: Filter,
    privately: boolean,
  ) => {
    return pull.asyncMap((root: UnboxedMsg, cb: CB<Thread>) => {
      this.isBlocking(
        { source: this.ssb.id, dest: root.value.author },
        (err: any, blocking: boolean) => {
          if (err) {
            cb(err);
          } else if (blocking) {
            cb(new Error('Author Blocked:' + root.value.author));
          } else {
            this.nonBlockedRootToThread(maxSize, filter, privately)(root, cb);
          }
        },
      );
    });
  };

  //#endregion

  //#region PUBLIC API

  @muxrpc('source')
  public public = (opts: Opts) => {
    const lt = opts.lt;
    const old = opts.old ?? true;
    const live = opts.live ?? false;
    const reverse = opts.reverse ?? true;
    const maxThreads = opts.limit ?? Infinity;
    const threadMaxSize = opts.threadMaxSize ?? Infinity;
    const filter = makeFilter(opts);

    return pull(
      this.publicIndex.read({
        lt: ['any', lt, undefined],
        reverse,
        live,
        old,
        keys: true,
        values: false,
        seqs: false,
      }),
      pull.filter(isValidIndexItem),
      pull.filter(isUniqueRootInIndexItem(new Set())),
      this.fetchRootMsgFromIndexItem,
      pull.filter(isPublic),
      this.removeMessagesFromBlocked,
      pull.filter(filter),
      pull.take(maxThreads),
      pull.asyncMap(this.nonBlockedRootToThread(threadMaxSize, filter)),
    );
  };

  @muxrpc('source')
  public publicUpdates = (opts: UpdatesOpts) => {
    const filter = makeFilter(opts);
    const includeSelf = opts.includeSelf ?? false;

    return pull(
      this.ssb.createFeedStream({
        old: false,
        live: true,
        reverse: false,
      }),
      includeSelf ? pull.through() : pull.filter(this.isNotMine),
      pull.filter(isPublic),
      this.removeMessagesFromBlocked,
      pull.filter(filter),
      pull.map((msg: Msg) => msg.key),
    );
  };

  @muxrpc('source')
  public private = (opts: Opts) => {
    if (!this.supportsPrivate) {
      throw new Error('"ssb-threads" is missing required plugin "ssb-private"');
    }
    const lt = opts.lt;
    const old = opts.old ?? true;
    const live = opts.live ?? false;
    const reverse = opts.reverse ?? true;
    const maxThreads = opts.limit ?? Infinity;
    const threadMaxSize = opts.threadMaxSize ?? Infinity;
    const filter = makeFilter(opts);

    const privateOpts = {
      reverse,
      live,
      old,
      query: reverse
        ? [{ $filter: { timestamp: lt ? { $lt: lt, $gt: 0 } : { $gt: 0 } } }]
        : [{ $filter: { timestamp: lt ? { $gt: lt } : { $gt: 0 } } }],
    };

    return pull(
      this.ssb.private.read(privateOpts),
      pull.filter((msg: any) => !!msg && !msg.sync && !!msg.key),
      pull.through((msg: Msg) => this.msgCache.set(msg.key, msg)),
      pull.map(getRootMsgId),
      pull.filter(isUniqueMsgId(new Set())),
      this.fetchMsgFromId,
      pull.map(this.maybeUnboxMsg),
      pull.filter((msg: Msg) => msg?.key),
      pull.through((msg: Msg) => this.msgCache.delete(msg.key)),
      pull.filter(isRootMsg),
      this.removeMessagesFromBlocked,
      pull.filter(filter),
      pull.take(maxThreads),
      pull.asyncMap(this.nonBlockedRootToThread(threadMaxSize, filter, true)),
    );
  };

  @muxrpc('source')
  public privateUpdates = (opts: UpdatesOpts) => {
    if (!this.supportsPrivate) {
      throw new Error('"ssb-threads" is missing required plugin "ssb-private"');
    }
    const filter = makeFilter(opts);
    const includeSelf = opts.includeSelf ?? false;

    return pull(
      this.ssb.private.read({
        old: false,
        live: true,
        reverse: false,
        query: [{ $filter: { timestamp: { $gt: 0 } } }],
      }),
      includeSelf ? pull.through() : pull.filter(this.isNotMine),
      this.removeMessagesFromBlocked,
      pull.filter(filter),
      pull.map(getRootMsgId),
    );
  };

  @muxrpc('source')
  public profile = (opts: ProfileOpts) => {
    const id = opts.id;
    const lt = opts.lt;
    const live = opts.live ?? false;
    const reverse = opts.reverse ?? true;
    const maxThreads = opts.limit ?? Infinity;
    const threadMaxSize = opts.threadMaxSize ?? Infinity;
    const filter = makeFilter(opts);

    return pull(
      this.profilesIndex.read({
        lt: [id, lt, undefined],
        gt: [id, null, undefined],
        reverse,
        live,
        keys: true,
        values: false,
        seqs: false,
      }),
      pull.filter(isValidIndexItem),
      pull.filter(isUniqueRootInIndexItem(new Set())),
      this.fetchRootMsgFromIndexItem,
      pull.filter(isPublic),
      this.removeMessagesFromBlocked,
      pull.filter(filter),
      pull.take(maxThreads),
      pull.asyncMap(this.nonBlockedRootToThread(threadMaxSize, filter)),
    );
  };

  @muxrpc('source')
  public thread = (opts: ThreadOpts) => {
    const privately = !!opts.private;
    if (privately && !this.supportsPrivate) {
      throw new Error('"ssb-threads" is missing required plugin "ssb-private"');
    }
    const threadMaxSize = opts.threadMaxSize ?? Infinity;
    const optsOk =
      !opts.allowlist && !opts.blocklist
        ? { ...opts, allowlist: ['post'] }
        : opts;
    const filterPosts = makeFilter(optsOk);

    return pull(
      pull.values([opts.root]),
      this.fetchMsgFromId,
      privately ? pull.map(this.maybeUnboxMsg) : pull.filter(isPublic),
      this.rootToThread(threadMaxSize, filterPosts, privately),
    );
  };

  @muxrpc('source')
  public threadUpdates = (opts: ThreadUpdatesOpts) => {
    const privately = !!opts.private;
    if (privately && !this.supportsPrivate) {
      throw new Error('"ssb-threads" is missing required plugin "ssb-private"');
    }
    const filter = makeFilter(opts);

    return pull(
      this.ssb.backlinks.read({
        query: [{ $filter: { dest: opts.root } }],
        index: 'DTA',
        old: false,
        live: true,
        reverse: false,
        private: privately,
      }),
      pull.filter(isIndirectReplyMsgToRoot(opts.root)),
      privately ? pull.filter(isPrivate) : pull.filter(isPublic),
      this.removeMessagesFromBlocked,
      pull.filter(filter),
    );
  };

  //#endregion
}

export = threads;

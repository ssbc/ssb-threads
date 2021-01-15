import { Msg, MsgId, UnboxedMsg, MsgInThread } from 'ssb-typescript';
import {
  isPublic as isPublicType,
  isRootMsg,
} from 'ssb-typescript/utils';
import { plugin, muxrpc } from 'secret-stack-decorators';
import {
  Opts,
  Thread,
  ProfileOpts,
  ThreadOpts,
  UpdatesOpts,
  FilterOpts,
  ThreadUpdatesOpts,
  ThreadSummary,
} from './types';
const pull = require('pull-stream');
const cat = require('pull-cat');
const sort = require('ssb-sort');
const ssbKeys = require('ssb-keys')
const Ref = require('ssb-ref');
const {
  and,
  author,
  descending,
  live,
  isPrivate,
  isPublic,
  hasRoot,
  toPullStream,
} = require('ssb-db2/operators');

type CB<T> = (err: any, val?: T) => void;
type Filter = (msg: Msg) => boolean;

function isIndirectReplyMsgToRoot(rootKey: MsgId) {
  return (msg: MsgInThread) =>
    msg?.value?.content?.root === rootKey ||
    msg?.value?.content?.fork === rootKey;
}

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
  // this msg has no root so we assume this is a root
  return msg.key;
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

function hasNoBacklinks(msg: Msg<any>): boolean {
  return (
    !msg?.value?.content?.root &&
    !msg?.value?.content?.branch &&
    !msg?.value?.content?.fork
  );
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

// FIXME: these filters are applied after the msgs are fetched, but we could do
// it *before*, via JITDB bitvectors
function makeFilter(opts: FilterOpts): (msg: Msg) => boolean {
  const passesAllowList = makeAllowFilter(opts.allowlist);
  const passesBlockList = makeBlockFilter(opts.blocklist);
  return (m: Msg) => passesAllowList(m) && passesBlockList(m);
}

@plugin('2.0.0')
class threads {
  private readonly ssb: Record<string, any>;
  private readonly isBlocking: (obj: any, cb: CB<boolean>) => void;

  constructor(ssb: Record<string, any>, _config: any) {
    this.ssb = ssb;
    this.isBlocking = ssb.friends?.isBlocking
      ? ssb.friends.isBlocking
      : IS_BLOCKING_NEVER;
  }

  //#region PRIVATE

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
            this.ssb.db.query(
              and(hasRoot(root.key)),
              // FIXME: dont we need to use `privately` here?
              descending(),
              toPullStream(),
            ),
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

  private nonBlockedRootToSummary = (
    filter: Filter,
    timestamps: Map<MsgId, number>,
  ) => {
    return (root: Msg, cb: CB<ThreadSummary>) => {
      pull(
        this.ssb.db.query(
          // FIXME: or(hasRoot, hasFork, hasBranch)
          and(hasRoot(root.key)),
          descending(),
          toPullStream(),
        ),
        pull.filter(isIndirectReplyMsgToRoot(root.key)),
        this.removeMessagesFromBlocked,
        pull.filter(filter),
        pull.collect((err2: any, arr: Array<Msg>) => {
          if (err2) return cb(err2);
          const timestamp = timestamps.get(root.key) ?? root.timestamp;
          cb(null, { root, replyCount: arr.length, timestamp });
        }),
      );
    };
  };

  /**
   * Returns a pull-stream operator that:
   * 1. Checks if there is a Msg in the cache for the source MsgId
   * 2. If not in the cache, do a database lookup
   */
  private fetchMsgFromId = (source: any) =>
    pull(
      source,
      pull.asyncMap((id: MsgId, cb: CB<Msg<any>>) => {
        this.ssb.db.getMsg(id, cb)
      }),
    );

  private maybeUnboxMsg = (msg: Msg): Msg | UnboxedMsg => {
    if (typeof msg.value.content !== 'string') return msg;
    return ssbKeys.unbox(msg, this.ssb.keys.private)
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
    // FIXME: support lt?
    const lt = opts.lt;
    const old = opts.old ?? true;
    const needsLive = opts.live ?? false;
    const needsDescending = opts.reverse ?? true;
    const maxThreads = opts.limit ?? Infinity;
    const threadMaxSize = opts.threadMaxSize ?? Infinity;
    const filter = makeFilter(opts);

    return pull(
      this.ssb.db.query(
        and(isPublic()),
        needsDescending ? descending() : null,
        needsLive ? live({ old }) : null,
        toPullStream(),
      ),
      pull.map(getRootMsgId),
      pull.filter(isUniqueMsgId(new Set())),
      this.fetchMsgFromId,
      pull.filter(isPublicType),
      pull.filter(hasNoBacklinks),
      this.removeMessagesFromBlocked,
      pull.filter(filter),
      pull.take(maxThreads),
      pull.asyncMap(this.nonBlockedRootToThread(threadMaxSize, filter)),
    );
  };

  @muxrpc('source')
  public publicSummary = (opts: Omit<Opts, 'threadMaxSize'>) => {
    // FIXME: support lt?
    const lt = opts.lt;
    const old = opts.old ?? true;
    const needsLive = opts.live ?? false;
    const needsDescending = opts.reverse ?? true;
    const maxThreads = opts.limit ?? Infinity;
    const filter = makeFilter(opts);
    const timestamps = new Map<MsgId, number>();

    return pull(
      this.ssb.db.query(
        and(isPublic()),
        needsDescending ? descending() : null,
        needsLive ? live({ old }) : null,
        toPullStream(),
      ),
      pull.through((msg: Msg) =>
        timestamps.set(getRootMsgId(msg), getTimestamp(msg)),
      ),
      pull.map(getRootMsgId),
      pull.filter(isUniqueMsgId(new Set())),
      this.fetchMsgFromId,
      pull.filter(isPublicType),
      pull.filter(hasNoBacklinks),
      this.removeMessagesFromBlocked,
      pull.filter(filter),
      pull.take(maxThreads),
      pull.asyncMap(this.nonBlockedRootToSummary(filter, timestamps)),
    );
  };

  @muxrpc('source')
  public publicUpdates = (opts: UpdatesOpts) => {
    const filter = makeFilter(opts);
    const includeSelf = opts.includeSelf ?? false;

    return pull(
      this.ssb.db.query(
        and(isPublic()),
        live({ old: false }),
        toPullStream(),
      ),
      includeSelf ? pull.through() : pull.filter(this.isNotMine),
      pull.filter(isPublicType),
      this.removeMessagesFromBlocked,
      pull.filter(filter),
      pull.map((msg: Msg) => msg.key),
    );
  };

  @muxrpc('source')
  public private = (opts: Opts) => {
    // FIXME: support lt?
    const lt = opts.lt;
    const old = opts.old ?? true;
    const needsLive = opts.live ?? false;
    const needsDescending = opts.reverse ?? true;
    const maxThreads = opts.limit ?? Infinity;
    const threadMaxSize = opts.threadMaxSize ?? Infinity;
    const filter = makeFilter(opts);

    return pull(
      this.ssb.db.query(
        and(isPrivate()),
        needsDescending ? descending() : null,
        needsLive ? live({ old }) : null,
        toPullStream(),
      ),
      pull.map(getRootMsgId),
      pull.filter(isUniqueMsgId(new Set())),
      this.fetchMsgFromId,
      pull.map(this.maybeUnboxMsg), // FIXME: not needed? can delete?
      pull.filter(isRootMsg),
      this.removeMessagesFromBlocked,
      pull.filter(filter),
      pull.take(maxThreads),
      pull.asyncMap(this.nonBlockedRootToThread(threadMaxSize, filter, true)),
    );
  };

  @muxrpc('source')
  public privateUpdates = (opts: UpdatesOpts) => {
    const filter = makeFilter(opts);
    const includeSelf = opts.includeSelf ?? false;

    return pull(
      this.ssb.db.query(
        and(isPrivate()),
        live({ old: false }),
        toPullStream(),
      ),
      includeSelf ? pull.through() : pull.filter(this.isNotMine),
      this.removeMessagesFromBlocked,
      pull.filter(filter),
      pull.map(getRootMsgId),
    );
  };

  @muxrpc('source')
  public profile = (opts: ProfileOpts) => {
    const id = opts.id;
    // FIXME: support lt?
    const lt = opts.lt;
    const old = opts.old ?? true;
    const needsLive = opts.live ?? false;
    const needsDescending = opts.reverse ?? true;
    const maxThreads = opts.limit ?? Infinity;
    const threadMaxSize = opts.threadMaxSize ?? Infinity;
    const filter = makeFilter(opts);

    return pull(
      this.ssb.db.query(
        and(author(id), isPublic()),
        needsDescending ? descending() : null,
        needsLive ? live({ old }) : null,
        toPullStream(),
      ),
      pull.map(getRootMsgId),
      pull.filter(isUniqueMsgId(new Set())),
      this.fetchMsgFromId,
      pull.filter(isPublicType),
      this.removeMessagesFromBlocked,
      pull.filter(filter),
      pull.take(maxThreads),
      pull.asyncMap(this.nonBlockedRootToThread(threadMaxSize, filter)),
    );
  };

  @muxrpc('source')
  public profileSummary = (opts: Omit<ProfileOpts, 'threadMaxSize'>) => {
    const id = opts.id;
    // FIXME: support lt
    const lt = opts.lt;
    const old = opts.old ?? true;
    const needsLive = opts.live ?? false;
    const needsDescending = opts.reverse ?? true;
    const maxThreads = opts.limit ?? Infinity;
    const filter = makeFilter(opts);
    const timestamps = new Map<MsgId, number>();

    return pull(
      this.ssb.db.query(
        and(author(id), isPublic()),
        needsDescending ? descending() : null,
        needsLive ? live({ old }) : null,
        toPullStream(),
      ),
      pull.through((msg: Msg) =>
        timestamps.set(getRootMsgId(msg), getTimestamp(msg)),
      ),
      pull.map(getRootMsgId),
      pull.filter(isUniqueMsgId(new Set())),
      this.fetchMsgFromId,
      pull.filter(isPublicType),
      pull.filter(hasNoBacklinks),
      this.removeMessagesFromBlocked,
      pull.filter(filter),
      pull.take(maxThreads),
      pull.asyncMap(this.nonBlockedRootToSummary(filter, timestamps)),
    );
  };

  @muxrpc('source')
  public thread = (opts: ThreadOpts) => {
    const privately = !!opts.private;
    const threadMaxSize = opts.threadMaxSize ?? Infinity;
    const optsOk =
      !opts.allowlist && !opts.blocklist
        ? { ...opts, allowlist: ['post'] }
        : opts;
    const filterPosts = makeFilter(optsOk);

    return pull(
      pull.values([opts.root]),
      this.fetchMsgFromId,
      privately ? pull.map(this.maybeUnboxMsg) : pull.filter(isPublicType),
      this.rootToThread(threadMaxSize, filterPosts, privately),
    );
  };

  @muxrpc('source')
  public threadUpdates = (opts: ThreadUpdatesOpts) => {
    const privately = !!opts.private;
    const filter = makeFilter(opts);

    return pull(
      this.ssb.db.query(
        and(hasRoot(opts.root), privately ? isPrivate() : isPublic()),
        live({ old: false }),
        toPullStream(),
      ),
      this.removeMessagesFromBlocked,
      pull.filter(filter),
    );
  };

  //#endregion
}

export = threads;

import { Msg, MsgId, UnboxedMsg } from 'ssb-typescript';
import {
  isPublic as isPublicType,
  isPrivate as isPrivateType,
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
  HashtagOpts,
  HashtagUpdatesOpts,
  HashtagsMatchingOpts,
  RecentHashtagsOpts,
} from './types';
const pull = require('pull-stream');
const cat = require('pull-cat');
const sort = require('ssb-sort');
const Ref = require('ssb-ref');
const {
  where,
  and,
  or,
  not,
  type,
  author,
  descending,
  live,
  batch,
  isPrivate,
  isPublic,
  hasRoot,
  hasFork,
  toPullStream,
} = require('ssb-db2/operators');

import HashtagsPlugin from './hashtags';

const hasHashtag = HashtagsPlugin.hasHashtagOperator;
const hasSomeHashtag = HashtagsPlugin.hasSomeHashtagOperator;

type CB<T> = (err: any, val?: T) => void;

const IS_BLOCKING_NEVER = (obj: any, cb: CB<boolean>) => {
  cb(null, false);
};

/**
 * 100 msgs kept in memory is rather small (~50kB), but this is large enough to
 * have good performance in JITDB pagination, see
 * https://github.com/ssb-ngi-pointer/jitdb/pull/123#issuecomment-782734363
 */
const BATCH_SIZE = 100;

function getTimestamp(msg: Msg<any>): number {
  const arrivalTimestamp = msg.timestamp;
  const declaredTimestamp = msg.value.timestamp;
  return Math.min(arrivalTimestamp, declaredTimestamp);
}

function getRootMsgId(msg: Msg<any>): MsgId {
  if (msg?.value?.content) {
    const fork = msg.value.content.fork;
    const root = msg.value.content.root;
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

function notNull(x: any): boolean {
  return x !== null;
}

// Strip leading # from hashtag string
function withoutLeadingHashtag(s: string) {
  return s.startsWith('#') ? s.slice(1) : s;
}

function makeFilterOperator(opts: FilterOpts): any {
  if (opts.allowlist) {
    const allowedTypes = opts.allowlist.map((x) => type(x));
    return or(...allowedTypes);
  }
  if (opts.blocklist) {
    const blockedTypes = opts.blocklist.map((x) => not(type(x)));
    return and(...blockedTypes);
  }
  return null;
}

function makePassesFilter(opts: FilterOpts): (msg: Msg) => boolean {
  if (opts.allowlist) {
    return (msg: Msg) =>
      opts.allowlist!.some((type) => msg?.value?.content?.type === type);
  }
  if (opts.blocklist) {
    return (msg: Msg) =>
      opts.blocklist!.every((type) => msg?.value?.content?.type !== type);
  }
  return () => true;
}

function assertFollowingOnlyUsability<
  T extends ((obj: any, cb: CB<boolean>) => void) | null,
>(enabled: boolean, isFollowing: T): asserts isFollowing is NonNullable<T> {
  if (enabled && !isFollowing) {
    throw new Error('ssb-threads requires ssb-friends installed');
  }
}

@plugin('2.0.0')
class threads {
  private readonly ssb: Record<string, any>;
  private readonly isBlocking: (obj: any, cb: CB<boolean>) => void;
  private readonly isFollowing: ((obj: any, cb: CB<boolean>) => void) | null;

  constructor(ssb: Record<string, any>, _config: any) {
    this.ssb = ssb;
    this.isBlocking = ssb.friends?.isBlocking
      ? ssb.friends.isBlocking
      : IS_BLOCKING_NEVER;
    this.isFollowing = ssb.friends?.isFollowing;
    this.ssb.db.registerIndex(HashtagsPlugin);
  }

  //#region PRIVATE

  // Make sure you're using this on a source that only returns root messages
  private onlyKeepFollowingRootMessages =
    (isFollowing: NonNullable<typeof this.isFollowing>) => (source: any) =>
      pull(
        source,
        pull.asyncMap((rootMsg: Msg, cb: CB<Msg | null>) => {
          if (rootMsg.value.author === this.ssb.id) {
            return cb(null, rootMsg);
          }

          isFollowing(
            { source: this.ssb.id, dest: rootMsg.value.author },
            (err: any, following: boolean) => {
              if (err) cb(err);
              else if (!following) cb(null, null);
              else cb(null, rootMsg);
            },
          );
        }),
        pull.filter(notNull),
      );

  private onlyKeepMessageIfFollowingRoot =
    (isFollowing: NonNullable<typeof this.isFollowing>, includeSelf: boolean) =>
    (source: any) =>
      pull(
        source,
        pull.asyncMap((msg: Msg, cb: CB<Msg | null>) => {
          const rootMsgKey = getRootMsgId(msg);

          if (includeSelf && msg.value.author === this.ssb.id) {
            return cb(null, msg);
          }

          this.ssb.db.getMsg(rootMsgKey, (err: any, rootMsg: Msg) => {
            if (err) cb(null, null);

            if (rootMsg.value.author === this.ssb.id) {
              return cb(null, msg);
            }

            isFollowing(
              { source: this.ssb.id, dest: rootMsg.value.author },
              (err: any, following: boolean) => {
                if (err) cb(err);
                else if (!following) cb(null, null);
                else cb(null, msg);
              },
            );
          });
        }),
        pull.filter(notNull),
      );

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
      pull.filter(notNull),
    );

  private removeMessagesWhereRootIsMissingOrBlocked =
    (passesFilter: (msg: Msg) => boolean) => (source: any) =>
      pull(
        source,
        pull.asyncMap((msg: Msg, cb: CB<Msg | null>) => {
          const rootMsgKey = getRootMsgId(msg);
          if (rootMsgKey === msg.key) return cb(null, msg);
          this.ssb.db.getMsg(rootMsgKey, (err: any, rootMsg: Msg) => {
            if (err) cb(null, null);
            else if (!passesFilter(rootMsg)) cb(null, null);
            else {
              this.isBlocking(
                { source: this.ssb.id, dest: rootMsg.value.author },
                (err, blocking: boolean) => {
                  if (err) cb(null, null);
                  else if (blocking) cb(null, null);
                  else cb(null, msg);
                },
              );
            }
          });
        }),
        pull.filter(notNull),
      );

  private nonBlockedRootToThread = (
    maxSize: number,
    filter: any,
    privately: boolean = false,
  ) => {
    return (root: Msg, cb: CB<Thread>) => {
      pull(
        cat([
          pull.values([root]),
          pull(
            this.ssb.db.query(
              where(
                and(
                  hasRoot(root.key),
                  filter,
                  privately ? isPrivate() : isPublic(),
                ),
              ),
              batch(BATCH_SIZE),
              descending(),
              toPullStream(),
            ),
            this.removeMessagesFromBlocked,
            pull.take(maxSize),
          ),
        ]),
        pull.take(maxSize + 1),
        pull.collect((err: any, arr: Array<Msg>) => {
          if (err) return cb(err);
          const full = arr.length <= maxSize;
          sort(arr);
          if (arr.length > maxSize && arr.length >= 3) arr.splice(1, 1);
          cb(null, { messages: arr, full });
        }),
      );
    };
  };

  private nonBlockedRootToSummary = (filter: any) => {
    return (root: Msg, cb: CB<ThreadSummary>) => {
      pull(
        this.ssb.db.query(
          where(and(or(hasRoot(root.key), hasFork(root.key)), filter)),
          batch(BATCH_SIZE),
          descending(),
          toPullStream(),
        ),
        this.removeMessagesFromBlocked,
        pull.collect((err: any, arr: Array<Msg>) => {
          if (err) return cb(err);
          const timestamp = Math.max(...arr.concat(root).map(getTimestamp));
          cb(null, { root, replyCount: arr.length, timestamp });
        }),
      );
    };
  };

  /**
   * Returns a pull-stream operator that maps the source of message keys
   * to their respective root messages, if the roots are in the database.
   */
  private fetchMsgFromIdIfItExists = (source: any) =>
    pull(
      source,
      pull.asyncMap((id: MsgId, cb: CB<Msg<any>>) => {
        this.ssb.db.getMsg(id, (err: any, msg: Msg) => {
          if (err) cb(null, null as any /* missing msg */);
          else cb(err, msg);
        });
      }),
      pull.filter(notNull),
    );

  private rootToThread = (maxSize: number, filter: any, privately: boolean) => {
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

  private rootMsgIdForHashtagMatch = (
    hashtags: Array<string>,
    opts: {
      needsDescending: boolean;
      msgPassesFilter: (msg: Msg) => boolean;
      queryFilter: any;
    },
  ) => {
    return pull(
      this.ssb.db.query(
        where(and(isPublic(), hasHashtag(hashtags), opts.queryFilter)),
        opts.needsDescending ? descending() : null,
        batch(BATCH_SIZE),
        toPullStream(),
      ),
      pull.map(getRootMsgId),
      pull.filter(isUniqueMsgId(new Set())),
      this.fetchMsgFromIdIfItExists,
      pull.filter(opts.msgPassesFilter),
      pull.filter(isPublicType),
      pull.filter(hasNoBacklinks),
      this.removeMessagesFromBlocked,
    );
  };

  //#endregion

  //#region PUBLIC API

  @muxrpc('source')
  public public = (opts: Opts) => {
    const needsDescending = opts.reverse ?? true;
    const threadMaxSize = opts.threadMaxSize ?? Infinity;
    const followingOnly = opts.following ?? false;
    const filterOperator = makeFilterOperator(opts);
    const passesFilter = makePassesFilter(opts);

    try {
      assertFollowingOnlyUsability(followingOnly, this.isFollowing);
    } catch (err) {
      return pull.error(err);
    }

    return pull(
      this.ssb.db.query(
        where(and(isPublic(), filterOperator)),
        needsDescending ? descending() : null,
        batch(BATCH_SIZE),
        toPullStream(),
      ),
      pull.map(getRootMsgId),
      pull.filter(isUniqueMsgId(new Set())),
      this.fetchMsgFromIdIfItExists,
      pull.filter(passesFilter),
      pull.filter(isPublicType),
      pull.filter(hasNoBacklinks),
      this.removeMessagesFromBlocked,
      followingOnly
        ? this.onlyKeepFollowingRootMessages(this.isFollowing)
        : pull.through(),
      pull.asyncMap(this.nonBlockedRootToThread(threadMaxSize, filterOperator)),
    );
  };

  @muxrpc('source')
  public publicSummary = (opts: Omit<Opts, 'threadMaxSize'>) => {
    const needsDescending = opts.reverse ?? true;
    const followingOnly = opts.following ?? false;
    const filterOperator = makeFilterOperator(opts);
    const passesFilter = makePassesFilter(opts);

    try {
      assertFollowingOnlyUsability(followingOnly, this.isFollowing);
    } catch (err) {
      return pull.error(err);
    }

    return pull(
      this.ssb.db.query(
        where(and(isPublic(), filterOperator)),
        needsDescending ? descending() : null,
        batch(BATCH_SIZE),
        toPullStream(),
      ),
      pull.map(getRootMsgId),
      pull.filter(isUniqueMsgId(new Set())),
      this.fetchMsgFromIdIfItExists,
      pull.filter(passesFilter),
      pull.filter(isPublicType),
      pull.filter(hasNoBacklinks),
      this.removeMessagesFromBlocked,
      followingOnly
        ? this.onlyKeepFollowingRootMessages(this.isFollowing)
        : pull.through(),
      pull.asyncMap(this.nonBlockedRootToSummary(filterOperator)),
    );
  };

  @muxrpc('source')
  public publicUpdates = (opts: UpdatesOpts) => {
    const filterOperator = makeFilterOperator(opts);
    const passesFilter = makePassesFilter(opts);
    const includeSelf = opts.includeSelf ?? false;
    const followingOnly = opts.following ?? false;

    try {
      assertFollowingOnlyUsability(followingOnly, this.isFollowing);
    } catch (err) {
      return pull.error(err);
    }

    return pull(
      this.ssb.db.query(
        where(
          and(
            isPublic(),
            filterOperator,
            includeSelf ? null : not(author(this.ssb.id, { dedicated: true })),
          ),
        ),
        live({ old: false }),
        toPullStream(),
      ),
      this.removeMessagesFromBlocked,
      this.removeMessagesWhereRootIsMissingOrBlocked(passesFilter),
      followingOnly
        ? this.onlyKeepMessageIfFollowingRoot(this.isFollowing, includeSelf)
        : pull.through(),
      pull.map((msg: Msg) => msg.key),
    );
  };

  @muxrpc('async')
  public hashtagCount = (
    opts: Omit<HashtagOpts, 'maxThreadSize' | 'reverse' | 'following'>,
    cb: CB<number>,
  ) => {
    if (!opts.hashtag || typeof opts.hashtag !== 'string') {
      cb(new Error('opts.hashtag is required'));
      return;
    }

    pull(
      this.rootMsgIdForHashtagMatch([opts.hashtag], {
        needsDescending: false,
        msgPassesFilter: makePassesFilter(opts),
        queryFilter: makeFilterOperator(opts),
      }),
      pull.reduce((count: number) => count + 1, 0, cb),
    );
  };

  @muxrpc('source')
  public hashtagSummary = (
    opts: Omit<HashtagOpts, 'threadMaxSize' | 'following'>,
  ) => {
    const filterOperator = makeFilterOperator(opts);
    let hashtags: Array<string> | null = null;
    if (opts.hashtags && Array.isArray(opts.hashtags)) {
      if (opts.hashtags.length === 0) {
        return pull.error(new Error('opts.hashtags must have at least one'));
      }
      if (opts.hashtags.some((h) => !h || typeof h !== 'string')) {
        return pull.error(
          new Error(
            'opts.hashtags must be an array of strings, but got: ' +
              opts.hashtags,
          ),
        );
      }
      hashtags = opts.hashtags;
    } else if (opts.hashtag && typeof opts.hashtag === 'string') {
      hashtags = [opts.hashtag];
    } else {
      return pull.error(new Error('opts.hashtag or opts.hashtags is required'));
    }

    return pull(
      this.rootMsgIdForHashtagMatch(hashtags, {
        needsDescending: opts.reverse ?? true,
        msgPassesFilter: makePassesFilter(opts),
        queryFilter: filterOperator,
      }),
      pull.asyncMap(this.nonBlockedRootToSummary(filterOperator)),
    );
  };

  @muxrpc('source')
  public hashtagUpdates = (opts: HashtagUpdatesOpts) => {
    const filterOperator = makeFilterOperator(opts);
    let hashtags: Array<string> | null = null;
    if (opts.hashtags && Array.isArray(opts.hashtags)) {
      if (opts.hashtags.length === 0) {
        return pull.error(new Error('opts.hashtags must have at least one'));
      }
      if (opts.hashtags.some((h) => !h || typeof h !== 'string')) {
        return pull.error(
          new Error(
            'opts.hashtags must be an array of strings, but got: ' +
              opts.hashtags,
          ),
        );
      }
      hashtags = opts.hashtags;
    } else if (opts.hashtag && typeof opts.hashtag === 'string') {
      hashtags = [opts.hashtag];
    } else {
      return pull.error(new Error('opts.hashtag or opts.hashtags is required'));
    }

    return pull(
      this.ssb.db.query(
        where(and(isPublic(), hasHashtag(hashtags), filterOperator)),
        live({ old: false }),
        toPullStream(),
      ),
      this.removeMessagesFromBlocked,
      pull.map(getRootMsgId),
    );
  };

  @muxrpc('async')
  public hashtagsMatching = (
    opts: HashtagsMatchingOpts,
    cb: CB<Array<[string, number]>>,
  ) => {
    if (typeof opts.query !== 'string' || opts.query.length === 0)
      return cb(new Error('opts.query must be non-empty string'));
    if (opts.limit && opts.limit <= 0)
      return cb(new Error('opts.limit must be number greater than 0'));

    const query = opts.query.toLocaleLowerCase();
    const limit = opts.limit || 10;
    this.ssb.db.onDrain('hashtags', () => {
      const hashtagsPlugin: HashtagsPlugin = this.ssb.db.getIndex('hashtags');
      hashtagsPlugin.getMatchingHashtags(query, limit, cb);
    });
  };

  @muxrpc('async')
  public recentHashtags = (opts: RecentHashtagsOpts, cb: CB<Array<string>>) => {
    if (typeof opts.limit !== 'number' || opts.limit <= 0)
      return cb(new Error('Limit must be number greater than 0'));

    const preserveCase = !!opts.preserveCase;

    // completely normalized hashtag (no leading # and lowercase) -> partially normalized (no leading #)
    const result = new Map<string, string>();

    return pull(
      this.ssb.db.query(
        where(and(isPublic(), hasSomeHashtag())),
        descending(),
        batch(BATCH_SIZE),
        toPullStream(),
      ),
      this.removeMessagesFromBlocked,
      pull.through((msg: Msg<any>) => {
        const { channel, mentions } = msg.value.content;

        if (channel) {
          const withoutHashtag = withoutLeadingHashtag(channel);
          const lowercaseWithoutHashtag = withoutHashtag.toLocaleLowerCase();

          // Since the messages received are descending,
          // we don't want to update the value for
          // associated key if it already exists
          // because we want the keep the most recent
          // variation of the hashtag (accounts for casing)
          if (!result.has(lowercaseWithoutHashtag)) {
            result.set(lowercaseWithoutHashtag, withoutHashtag);
          }
        } else if (Array.isArray(mentions)) {
          for (const { link } of mentions) {
            // msg.value.content.mentions[].link SHOULD have `#`
            if (link && typeof link === 'string' && link.startsWith('#')) {
              const withoutHashtag = withoutLeadingHashtag(link);
              const lowercaseWithoutHashtag =
                withoutHashtag.toLocaleLowerCase();

              // Since the messages received are descending,
              // we don't want to update the value for
              // associated key if it already exists
              // because we want the keep the most recent
              // variation of the hashtag (accounts for casing)
              if (!result.has(lowercaseWithoutHashtag)) {
                result.set(lowercaseWithoutHashtag, withoutHashtag);
              }

              if (result.size === opts.limit) break;
            }
          }
        }
      }),
      // Keep taking values until the result size === limit
      pull.take(() => result.size < opts.limit),
      pull.onEnd(() => {
        cb(null, Array.from(preserveCase ? result.values() : result.keys()));
      }),
    );
  };

  @muxrpc('source')
  public private = (opts: Opts) => {
    const needsDescending = opts.reverse ?? true;
    const threadMaxSize = opts.threadMaxSize ?? Infinity;
    const filterOperator = makeFilterOperator(opts);
    const passesFilter = makePassesFilter(opts);

    return pull(
      this.ssb.db.query(
        where(and(isPrivate(), filterOperator)),
        needsDescending ? descending() : null,
        batch(BATCH_SIZE),
        toPullStream(),
      ),
      pull.map(getRootMsgId),
      pull.filter(isUniqueMsgId(new Set())),
      this.fetchMsgFromIdIfItExists,
      pull.filter(passesFilter),
      pull.filter(isPrivateType),
      pull.filter(hasNoBacklinks),
      this.removeMessagesFromBlocked,
      pull.asyncMap(
        this.nonBlockedRootToThread(threadMaxSize, filterOperator, true),
      ),
    );
  };

  @muxrpc('source')
  public privateUpdates = (opts: UpdatesOpts) => {
    const filterOperator = makeFilterOperator(opts);
    const includeSelf = opts.includeSelf ?? false;

    return pull(
      this.ssb.db.query(
        where(
          and(
            isPrivate(),
            filterOperator,
            includeSelf ? null : not(author(this.ssb.id, { dedicated: true })),
          ),
        ),
        live({ old: false }),
        toPullStream(),
      ),
      this.removeMessagesFromBlocked,
      pull.map(getRootMsgId),
    );
  };

  @muxrpc('source')
  public profile = (opts: ProfileOpts) => {
    const id = opts.id;
    const needsDescending = opts.reverse ?? true;
    const threadMaxSize = opts.threadMaxSize ?? Infinity;
    const filterOperator = makeFilterOperator(opts);
    const passesFilter = makePassesFilter(opts);

    return pull(
      this.ssb.db.query(
        where(and(author(id), isPublic(), filterOperator)),
        needsDescending ? descending() : null,
        batch(BATCH_SIZE),
        toPullStream(),
      ),
      pull.map(getRootMsgId),
      pull.filter(isUniqueMsgId(new Set())),
      this.fetchMsgFromIdIfItExists,
      pull.filter(passesFilter),
      pull.filter(isPublicType),
      this.removeMessagesFromBlocked,
      pull.asyncMap(this.nonBlockedRootToThread(threadMaxSize, filterOperator)),
    );
  };

  @muxrpc('source')
  public profileSummary = (opts: Omit<ProfileOpts, 'threadMaxSize'>) => {
    const id = opts.id;
    const needsDescending = opts.reverse ?? true;
    const filterOperator = makeFilterOperator(opts);
    const passesFilter = makePassesFilter(opts);

    return pull(
      this.ssb.db.query(
        where(and(author(id), isPublic(), filterOperator)),
        needsDescending ? descending() : null,
        batch(BATCH_SIZE),
        toPullStream(),
      ),
      pull.map(getRootMsgId),
      pull.filter(isUniqueMsgId(new Set())),
      this.fetchMsgFromIdIfItExists,
      pull.filter(passesFilter),
      pull.filter(isPublicType),
      pull.filter(hasNoBacklinks),
      this.removeMessagesFromBlocked,
      pull.asyncMap(this.nonBlockedRootToSummary(filterOperator)),
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
    const filterOperator = makeFilterOperator(optsOk);

    return pull(
      pull.values([opts.root]),
      this.fetchMsgFromIdIfItExists,
      privately ? pull.through() : pull.filter(isPublicType),
      this.rootToThread(threadMaxSize, filterOperator, privately),
    );
  };

  @muxrpc('source')
  public threadUpdates = (opts: ThreadUpdatesOpts) => {
    const privately = !!opts.private;
    const filterOperator = makeFilterOperator(opts);

    return pull(
      this.ssb.db.query(
        where(
          and(
            hasRoot(opts.root),
            filterOperator,
            privately ? isPrivate() : isPublic(),
          ),
        ),
        live({ old: false }),
        toPullStream(),
      ),
      this.removeMessagesFromBlocked,
    );
  };

  //#endregion
}

export = threads;

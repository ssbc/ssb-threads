const bipf = require('bipf');
const pl = require('pull-level');
const pull = require('pull-stream');
const DB2Plugin = require('ssb-db2/indexes/plugin');
const { seqs, liveSeqs, deferred } = require('ssb-db2/operators');

const B_0 = Buffer.alloc(0);
const BIPF_CONTENT = bipf.allocAndEncode('content');
const BIPF_CHANNEL = bipf.allocAndEncode('channel');
const BIPF_MENTIONS = bipf.allocAndEncode('mentions');

function sanitize(hashtag: string) {
  return hashtag.startsWith('#')
    ? hashtag.slice(1).toLocaleLowerCase()
    : hashtag.toLocaleLowerCase();
}

type LevelKey = [string, number];
type LevelValue = Buffer;
type AAOLRecord = { value: Buffer; offset: number };

const INDEX_NAME = 'hashtags';
const INDEX_VERSION = 2;

// [hashtagLabel, seq] => B_0
export = class HashtagPlugin extends DB2Plugin {
  constructor(log: any, dir: string) {
    super(log, dir, INDEX_NAME, INDEX_VERSION, 'json', 'binary');
  }

  static operator(texts: Array<string>) {
    return deferred((meta: any, cb: any, onAbort: any) => {
      meta.db.onDrain(INDEX_NAME, () => {
        const plugin = meta.db.getIndex(INDEX_NAME) as HashtagPlugin;
        plugin.getMessagesByHashtags(texts, meta.live, cb, onAbort);
      });
    });
  }

  processRecord(record: AAOLRecord, seq: number, pValue: number) {
    const buf = record.value;
    const pValueContent = bipf.seekKey2(buf, pValue, BIPF_CONTENT, 0);
    if (pValueContent < 0) return;
    const pValueContentChannel = bipf.seekKey2(
      buf,
      pValueContent,
      BIPF_CHANNEL,
      0,
    );
    const pValueContentMentions = bipf.seekKey2(
      buf,
      pValueContent,
      BIPF_MENTIONS,
      0,
    );

    if (pValueContentChannel >= 0) {
      const channel = bipf.decode(buf, pValueContentChannel);
      // msg.value.content.channel typically does not have `#`
      if (channel && typeof channel === 'string') {
        const label = sanitize(channel);
        this.batch.push({
          type: 'put',
          key: [label, seq] as LevelKey,
          value: B_0 as LevelValue,
        });
      }
    }

    if (pValueContentMentions >= 0) {
      const mentions = bipf.decode(buf, pValueContentMentions);
      if (Array.isArray(mentions)) {
        for (const { link } of mentions) {
          // msg.value.content.mentions[].link SHOULD have `#`
          if (link && typeof link === 'string' && link.startsWith('#')) {
            const label = sanitize(link);
            this.batch.push({
              type: 'put',
              key: [label, seq] as LevelKey,
              value: B_0 as LevelValue,
            });
          }
        }
      }
    }
  }

  /**
   * Gets the `seq` of all messages that have *any* of the given hashtags.
   */
  getMessagesByHashtags(
    hashtags: Array<string>,
    live: 'liveOnly' | 'liveAndOld' | undefined,
    cb: (err: any, opData?: any) => void,
    onAbort: (listener: () => void) => void,
  ) {
    if (!hashtags || !Array.isArray(hashtags)) return cb(null, seqs([]));
    if (live === 'liveAndOld') return cb(new Error('unimplemented liveAndOld'));

    const labels = hashtags.map(sanitize);
    const sortedLabels = labels.sort((a, b) => a.localeCompare(b));
    const minLabel = sortedLabels[0];
    const maxLabel = sortedLabels[sortedLabels.length - 1];

    if (live) {
      const ps = pull(
        pl.read(this.level, {
          gte: [minLabel, ''],
          lte: [maxLabel, undefined],
          keys: true,
          keyEncoding: this.keyEncoding,
          values: false,
          live: true,
          old: false,
        }),
        pull.filter(([label, _seq]: LevelKey) => labels.includes(label)),
        pull.map(([_label, seq]: LevelKey) => seq),
      );
      return cb(null, liveSeqs(ps));
    } else {
      let drainer: { abort: () => void } | undefined;

      onAbort(() => {
        drainer?.abort();
      });

      const seqArr: Array<number> = [];
      pull(
        pull.values(sortedLabels),
        pull.map((label: string) =>
          pl.read(this.level, {
            gte: [label, ''],
            lte: [label, undefined],
            keys: true,
            keyEncoding: this.keyEncoding,
            values: false,
          }),
        ),
        pull.flatten(),
        (drainer = pull.drain(
          ([, seq]: LevelKey) => seqArr.push(seq),
          (err: any) => {
            drainer = undefined;
            if (err) cb(err);
            else cb(null, seqs(seqArr));
          },
        )),
      );
    }
  }

  /**
   * Gets a list of hashtags of length `limit` that start with the `query`
   */
  getMatchingHashtags(
    query: string,
    limit: number,
    cb: (err: any, data?: any) => void,
  ) {
    // hashtag -> count
    const result = new Map<string, number>();

    // Upperbound is determined by replacing the last character of the query with the one whose char code is +1 greater
    const lessThan =
      query.slice(0, query.length - 1) +
      String.fromCharCode(query.charCodeAt(query.length - 1) + 1);

    pull(
      pl.read(this.level, {
        gte: [query, ''],
        lt: [lessThan, ''],
        keys: true,
        keyEncoding: this.keyEncoding,
        values: false,
      }),
      pull.drain(
        ([label]: LevelKey) => {
          const count = result.get(label) || 0;
          result.set(label, count + 1);
        },
        (err: any) => {
          if (err) cb(err);
          else {
            // Order by count from highest to lowest
            const sorted = Array.from(result.entries()).sort(
              ([, c1], [, c2]) => c2 - c1,
            );

            cb(null, limit > 0 ? sorted.slice(0, limit) : sorted);
          }
        },
      ),
    );
  }
};

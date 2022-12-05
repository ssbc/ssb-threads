const bipf = require('bipf');
const pl = require('pull-level');
const pull = require('pull-stream');
const DB2Plugin = require('ssb-db2/indexes/plugin');
const { seqs, deferred } = require('ssb-db2/operators');

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
        plugin.getMessagesByHashtags(texts, cb, onAbort);
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
    cb: (err: any, opData?: any) => void,
    onAbort: (listener: () => void) => void,
  ) {
    if (!hashtags || !Array.isArray(hashtags)) return cb(null, seqs([]));

    const labels = hashtags.map(sanitize);
    let drainer: { abort: () => void } | undefined;
    const seqArr: Array<number> = [];
    const sortedLabels = labels.sort((a, b) => a.localeCompare(b));

    onAbort(() => {
      drainer?.abort();
    });

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
};

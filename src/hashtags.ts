const bipf = require('bipf');
const pl = require('pull-level');
const pull = require('pull-stream');
const DB2Plugin = require('ssb-db2/indexes/plugin');
const { seqs, deferred } = require('ssb-db2/operators');

const B_0 = Buffer.alloc(0);
const B_CONTENT = Buffer.from('content');
const B_CHANNEL = Buffer.from('channel');
const B_MENTIONS = Buffer.from('mentions');

function sanitize(hashtag: string) {
  return hashtag.startsWith('#')
    ? hashtag.slice(1).toLocaleLowerCase()
    : hashtag.toLocaleLowerCase();
}

type LevelKey = [string, number];
type LevelValue = Buffer;

const INDEX_NAME = 'hashtags';
const INDEX_VERSION = 2;

// [hashtagLabel, seq] => B_0
export = class HashtagPlugin extends DB2Plugin {
  constructor(log: any, dir: string) {
    super(log, dir, INDEX_NAME, INDEX_VERSION, 'json', 'binary');
  }

  static operator(text: string) {
    return deferred((meta: any, cb: any, onAbort: any) => {
      meta.db.onDrain(INDEX_NAME, () => {
        const plugin = meta.db.getIndex(INDEX_NAME) as HashtagPlugin;
        plugin.getMessagesByHashtag(text, cb, onAbort);
      });
    });
  }

  processRecord(record: { value: Buffer; offset: number }, seq: number, pValue: number) {
    const buf = record.value;
    const pValueContent = bipf.seekKey(buf, pValue, B_CONTENT);
    if (pValueContent < 0) return;
    const pValueContentChannel = bipf.seekKey(buf, pValueContent, B_CHANNEL);
    const pValueContentMentions = bipf.seekKey(buf, pValueContent, B_MENTIONS);

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

  getMessagesByHashtag(
    hashtag: any,
    cb: (err: any, opData?: any) => void,
    onAbort: (listener: () => void) => void,
  ) {
    if (!hashtag || typeof hashtag !== 'string') return cb(null, seqs([]));

    const label = sanitize(hashtag);
    let drainer: { abort: () => void } | undefined;
    const seqArr: Array<number> = [];

    onAbort(() => {
      drainer?.abort();
    });

    pull(
      pl.read(this.level, {
        gte: [label, ''],
        lte: [label, undefined],
        keys: true,
        keyEncoding: this.keyEncoding,
        values: false,
      }),
      (drainer = pull.drain(
        ([, seq]: LevelKey) => seqArr.push(seq),
        (err: any) => {
          if (err) return cb(err);
          else cb(null, seqs(seqArr));
        },
      )),
    );
  }
};

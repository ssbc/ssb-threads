import { Msg, MsgId } from 'ssb-typescript';

export type Thread = {
  messages: Array<Msg>;
  full: boolean;
};

export type ThreadSummary = {
  root: Msg;
  replyCount: number;

  /**
   * Timestamp of the latest post in this thread
   */
  timestamp: number;
};

export type FilterOpts = {
  allowlist?: Array<string>;
  blocklist?: Array<string>;
  following?: boolean;
};

export type Opts = {
  reverse?: boolean;
  threadMaxSize?: number;
} & FilterOpts;

export type HashtagOpts = {
  reverse?: boolean;
  hashtag: string;
  hashtags?: Array<string>;
  threadMaxSize?: number;
} & FilterOpts;

export type UpdatesOpts = {
  includeSelf?: boolean;
} & FilterOpts;

export type HashtagUpdatesOpts =
  | ({ hashtag: string; hashtags: undefined } & FilterOpts)
  | ({ hashtag: undefined; hashtags: Array<string> } & FilterOpts);

export type ThreadOpts = {
  root: MsgId;
  private?: boolean;
  threadMaxSize?: number;
} & FilterOpts;

export type ThreadUpdatesOpts = {
  root: MsgId;
  private?: boolean;
} & FilterOpts;

export type ProfileOpts = Opts & {
  id: string;
  initiatedOnly?: boolean;
};

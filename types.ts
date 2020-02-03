import { Msg, MsgId } from 'ssb-typescript';

export type Thread = {
  messages: Array<Msg>;
  full: boolean;
};

export type FilterOpts = {
  allowlist?: Array<string>;
  blocklist?: Array<string>;
};

export type Opts = {
  lt?: number;
  limit?: number;
  old?: boolean;
  live?: boolean;
  reverse?: boolean;
  threadMaxSize?: number;
} & FilterOpts;

export type UpdatesOpts = {
  includeSelf?: boolean;
} & FilterOpts;

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
};

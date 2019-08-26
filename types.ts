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
  live?: boolean;
  reverse?: boolean;
  threadMaxSize?: number;
} & FilterOpts;

export type UpdatesOpts = {} & FilterOpts;

export type ThreadOpts = {
  root: MsgId;
  threadMaxSize?: number;
} & FilterOpts;

export type ProfileOpts = Opts & {
  id: string;
};

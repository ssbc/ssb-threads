import { Msg, MsgId } from 'ssb-typescript';

export type Thread = {
  messages: Array<Msg>;
  full: boolean;
};

export type FilterOpts = {
  whitelist?: Array<string>;
  blacklist?: Array<string>;
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
};

export type ProfileOpts = Opts & {
  id: string;
};

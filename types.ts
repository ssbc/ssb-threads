import { Msg, MsgId } from 'ssb-typescript';

export type ThreadData = {
  messages: Array<Msg>;
  full: boolean;
};

export type Opts = {
  lt?: number;
  limit?: number;
  threadMaxSize?: number;
  whitelist?: Array<string>;
  blacklist?: Array<string>;
};

export type ThreadOpts = {
  root: MsgId;
  threadMaxSize?: number;
};

export type ProfileOpts = Opts & {
  id: string;
};

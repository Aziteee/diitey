declare module "@meting/core" {
  export default class Meting {
    constructor(server?: string);
    cookie(cookie: string): this;
    format(enabled?: boolean): this;
    song(id: string): Promise<string>;
    url(id: string, bitrate?: number): Promise<string>;
    pic(id: string, size?: number): Promise<string>;
  }
}

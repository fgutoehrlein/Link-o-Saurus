declare module 'fflate' {
  export type ZipInput = Record<string, Uint8Array | string>;

  export type ZipOptions = {
    level?: number;
  };

  export function zipSync(input: ZipInput, options?: ZipOptions): Uint8Array;

  export function strToU8(value: string, latin1?: boolean): Uint8Array;
}

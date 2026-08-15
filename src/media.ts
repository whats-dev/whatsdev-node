import type { ApiResponse } from './http/transport'

/** A downloaded file: the bytes as streamed, plus the type named — decoding it as JSON would discard the answer. */
export interface MediaFile {
  bytes: Uint8Array
  contentType: string | null
}

export function mediaFileFromResponse(response: ApiResponse<unknown>): MediaFile {
  return {
    bytes: response.bytes,
    contentType: response.headers.get('Content-Type'),
  }
}

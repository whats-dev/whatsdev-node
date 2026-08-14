import type { ApiResponse } from './http/transport'

/**
 * A downloaded file: the bytes exactly as the server streamed them, plus the type it named them.
 *
 * Every other endpoint answers JSON, so every other method hands back a decoded object. This one
 * streams a stored file, and decoding it as JSON would throw the only thing the caller wanted away.
 */
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

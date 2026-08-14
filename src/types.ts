export interface MediaPayload {
  url?: string
  data?: string
  mimetype?: string
  filename?: string
}

export interface LocationPayload {
  latitude: number
  longitude: number
  title?: string
}

export interface PollPayload {
  name: string
  options: string[]
  multiple: boolean
}

// The wire format is snake_case; known fields are mapped explicitly, everything else passes through.
export interface SendOptions {
  replyTo?: string
  sendAt?: string
  caption?: string
  asNote?: boolean
  [key: string]: unknown
}

/** Error codes shared by every asset source; the UI maps each to an i18n key `errors.<code>`. */
export type SourceErrorCode =
  | 'unauthorized'
  | 'sso'
  | 'forbidden'
  | 'notFound'
  | 'rateLimited'
  | 'network'
  | 'truncated'
  | 'unknown'

export interface SourceErrorDetail {
  /** Epoch ms when the rate limit resets. */
  resetAt?: number
  /** URL where the user authorises the token for SAML SSO. */
  ssoUrl?: string
}

export class SourceError extends Error {
  constructor(
    readonly code: SourceErrorCode,
    message: string,
    readonly detail: SourceErrorDetail = {}
  ) {
    super(message)
    this.name = 'SourceError'
  }
}

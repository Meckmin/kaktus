import { buildAuthHeaders } from './signature';

/**
 * Iyzico HTTP transport.
 *
 * Hand-rolled rather than using the official `iyzipay` npm package, for three
 * reasons: the package is callback-based and awkward to await, it does not
 * expose the raw request and response bodies we need to persist as dispute
 * evidence, and its signing targets the retired SHA1 scheme. The v2 HMAC
 * scheme is about ten lines, so the dependency buys little.
 *
 * The trade-off is that we now own the correctness of the auth signature.
 * That is why it lives in `signature.ts` with a test reproducing Iyzico's own
 * documented worked example.
 */

export interface IyzicoConfig {
  apiKey: string;
  secretKey: string;
  baseUrl: string;
  /** Reject unsigned responses. Must be true in production. */
  requireSignature: boolean;
  timeoutMs?: number;
}

export class IyzicoError extends Error {
  constructor(
    message: string,
    readonly kind: 'NETWORK' | 'TIMEOUT' | 'HTTP' | 'API' | 'SIGNATURE' | 'MALFORMED',
    readonly errorCode?: string,
    readonly httpStatus?: number,
    readonly raw?: unknown,
  ) {
    super(message);
    this.name = 'IyzicoError';
  }

  /**
   * Whether a retry could plausibly succeed.
   *
   * Deliberately conservative: an API-level failure ("insufficient funds",
   * "invalid card") must never be retried, because retrying a payment that the
   * bank already declined for a business reason risks a duplicate charge if the
   * decline was actually a timeout misreported as a decline.
   */
  get retryable(): boolean {
    return this.kind === 'NETWORK' || this.kind === 'TIMEOUT' || (this.httpStatus ?? 0) >= 500;
  }
}

export interface IyzicoResponse {
  status: 'success' | 'failure';
  errorCode?: string;
  errorMessage?: string;
  locale?: string;
  systemTime?: number;
  conversationId?: string;
  signature?: string;
  [key: string]: unknown;
}

const DEFAULT_TIMEOUT_MS = 20_000;

export class IyzicoClient {
  constructor(private readonly config: IyzicoConfig) {
    if (!config.apiKey || !config.secretKey) {
      throw new Error('Iyzico apiKey and secretKey are required');
    }
  }

  get secretKey(): string {
    return this.config.secretKey;
  }

  get requireSignature(): boolean {
    return this.config.requireSignature;
  }

  /**
   * Posts a JSON request and returns the parsed response.
   *
   * The body is serialised exactly once and that same string is both signed and
   * sent. Iyzico signs `randomKey + uriPath + body`, so any re-serialisation
   * (different key order, different whitespace) between signing and sending
   * yields a 401 that is genuinely painful to debug.
   */
  async post<T extends IyzicoResponse>(
    uriPath: string,
    body: Record<string, unknown>,
  ): Promise<{ data: T; rawRequest: string; rawResponse: string }> {
    const rawRequest = JSON.stringify(body);
    const headers = buildAuthHeaders({
      apiKey: this.config.apiKey,
      secretKey: this.config.secretKey,
      uriPath,
      requestBody: rawRequest,
    });

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}${uriPath}`, {
        method: 'POST',
        headers,
        body: rawRequest,
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = (error as Error).name === 'AbortError';
      throw new IyzicoError(
        aborted ? `Iyzico request to ${uriPath} timed out` : `Network failure calling ${uriPath}`,
        aborted ? 'TIMEOUT' : 'NETWORK',
        undefined,
        undefined,
        error,
      );
    } finally {
      clearTimeout(timeout);
    }

    const rawResponse = await response.text();

    if (!response.ok && rawResponse.length === 0) {
      throw new IyzicoError(
        `Iyzico returned HTTP ${response.status} for ${uriPath}`,
        'HTTP',
        undefined,
        response.status,
      );
    }

    let data: T;
    try {
      data = JSON.parse(rawResponse) as T;
    } catch {
      throw new IyzicoError(
        `Iyzico returned a non-JSON body for ${uriPath}`,
        'MALFORMED',
        undefined,
        response.status,
        rawResponse.slice(0, 500),
      );
    }

    return { data, rawRequest, rawResponse };
  }
}

/**
 * A timed-out payment request is the single most dangerous outcome in this
 * integration: the charge may or may not have happened, and we cannot tell from
 * the error. Never retry blindly — query the payment by conversationId first.
 * The Checkout Form flow makes this tractable because the token is ours and the
 * retrieve endpoint is idempotent.
 */
export const TIMEOUT_RECOVERY_NOTE =
  'On TIMEOUT, do not retry the charge. Call retrieveCheckoutForm(token) to determine the true outcome.';

import * as http2 from "http2";
import * as jwt from "jsonwebtoken";
import { SupabaseClient } from "@supabase/supabase-js";
import { Database } from "../config/supabase";

// MARK: - Types

interface APNSPayload {
  aps: {
    alert: {
      title: string;
      body: string;
      subtitle?: string;
    };
    sound?: string;
    badge?: number;
    "thread-id"?: string;
    "mutable-content"?: number;
  };
  notification_type?: string;
  general_gift_idea_id?: string;
  product_count?: number;
  [key: string]: any;
}

interface APNSResponse {
  success: boolean;
  statusCode: number;
  reason?: string;
}

interface DeviceToken {
  device_token: string;
  is_sandbox: boolean;
}

// MARK: - Configuration

const apnsConfig = {
  keyId: process.env.APNS_KEY_ID || "",
  teamId: process.env.APNS_TEAM_ID || "",
  bundleId: process.env.APNS_BUNDLE_ID || "",
  keyBase64: process.env.APNS_KEY_BASE64 || "",
  environment: (process.env.APNS_ENVIRONMENT || "sandbox") as
    | "sandbox"
    | "production",
};

function getAPNSEndpoint(): string {
  return apnsConfig.environment === "production"
    ? "https://api.push.apple.com"
    : "https://api.sandbox.push.apple.com";
}

// MARK: - JWT Token Management

let cachedToken: string | null = null;
let tokenExpiry: number = 0;

/**
 * Generate a JWT token for APNS authentication
 * Tokens are valid for up to 1 hour, we refresh after 50 minutes
 */
function generateAPNSToken(): string {
  const now = Math.floor(Date.now() / 1000);

  // Return cached token if still valid (with 10 minute buffer)
  if (cachedToken && tokenExpiry > now + 600) {
    return cachedToken;
  }

  // Read the private key from base64 env var
  if (!apnsConfig.keyBase64) {
    throw new Error("APNS_KEY_BASE64 environment variable is not set");
  }

  const privateKey = Buffer.from(apnsConfig.keyBase64, "base64").toString(
    "utf8"
  );

  // Create JWT payload
  const payload = {
    iss: apnsConfig.teamId,
    iat: now,
  };

  // Sign the token
  const token = jwt.sign(payload, privateKey, {
    algorithm: "ES256",
    header: {
      alg: "ES256",
      kid: apnsConfig.keyId,
    },
  });

  // Cache the token
  cachedToken = token;

  // Set expiry to 50 minutes from now
  tokenExpiry = now + 3000;

  console.log("🔐 [APNS] Generated new JWT token");
  return token;
}

// MARK: - HTTP/2 Client

let http2Client: http2.ClientHttp2Session | null = null;

/**
 * Get or create HTTP/2 client connection to APNS
 */
function getHTTP2Client(): Promise<http2.ClientHttp2Session> {
  return new Promise((resolve, reject) => {
    if (http2Client && !http2Client.destroyed) {
      resolve(http2Client);
      return;
    }

    const endpoint = getAPNSEndpoint();
    console.log(`🔌 [APNS] Connecting to: ${endpoint}`);

    http2Client = http2.connect(endpoint);

    http2Client.on("error", (err) => {
      console.error("❌ [APNS] HTTP/2 connection error:", err);
      reject(err);
    });

    http2Client.on("connect", () => {
      console.log("✅ [APNS] Connected");
      resolve(http2Client!);
    });
  });
}

/**
 * Close the HTTP/2 connection
 */
export function closeAPNSConnection(): void {
  if (http2Client && !http2Client.destroyed) {
    http2Client.close();
    http2Client = null;
    console.log("🔌 [APNS] Connection closed");
  }
}

// MARK: - Send Push Notification

/**
 * Send a push notification to a single device
 */
export async function sendPushNotification(
  deviceToken: string,
  payload: APNSPayload,
  isSandbox: boolean = true
): Promise<APNSResponse> {
  return new Promise(async (resolve) => {
    try {
      const client = await getHTTP2Client();
      const token = generateAPNSToken();

      const headers = {
        ":method": "POST",
        ":path": `/3/device/${deviceToken}`,
        authorization: `bearer ${token}`,
        "apns-topic": apnsConfig.bundleId,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-expiration": "0",
        "content-type": "application/json",
      };

      const body = JSON.stringify(payload);

      const req = client.request(headers);

      let responseData = "";
      let statusCode = 0;

      req.on("response", (headers) => {
        statusCode = headers[":status"] as number;
      });

      req.on("data", (chunk) => {
        responseData += chunk;
      });

      req.on("end", () => {
        if (statusCode === 200) {
          resolve({
            success: true,
            statusCode,
          });
        } else {
          let reason = "Unknown error";
          try {
            const parsed = JSON.parse(responseData);
            reason = parsed.reason || reason;
          } catch {}

          resolve({
            success: false,
            statusCode,
            reason,
          });
        }
      });

      req.on("error", (err) => {
        resolve({
          success: false,
          statusCode: 0,
          reason: err.message,
        });
      });

      req.write(body);
      req.end();
    } catch (err) {
      resolve({
        success: false,
        statusCode: 0,
        reason: err instanceof Error ? err.message : "Unknown error",
      });
    }
  });
}

// MARK: - Products Ready Notification

/**
 * Send a "Products Ready" notification to a user
 * Called when product generation job completes successfully
 */
export async function sendProductsReadyNotification(
  supabase: SupabaseClient<Database>,
  userId: string,
  generalGiftIdeaId: string,
  productCount: number,
  ideaText: string
): Promise<{ sent: number; failed: number; errors: string[] }> {
  const results = {
    sent: 0,
    failed: 0,
    errors: [] as string[],
  };

  // Check if APNS is configured
  if (!apnsConfig.keyBase64 || !apnsConfig.keyId || !apnsConfig.teamId) {
    console.log(
      "⚠️ [APNS] Not configured - skipping products ready notification"
    );
    return results;
  }

  try {
    // Fetch device tokens for the user
    const { data: deviceTokens, error: tokensError } = await supabase
      .from("device_tokens")
      .select("device_token, is_sandbox")
      .eq("user_id", userId);

    if (tokensError) {
      console.error(
        `❌ [APNS] Error fetching device tokens for user ${userId}:`,
        tokensError
      );
      results.errors.push(
        `Failed to fetch device tokens: ${tokensError.message}`
      );
      return results;
    }

    if (!deviceTokens || deviceTokens.length === 0) {
      console.log(`⚠️ [APNS] No device tokens found for user ${userId}`);
      return results;
    }

    console.log(
      `📱 [APNS] Sending products ready notification to ${deviceTokens.length} device(s)`
    );

    // Create the notification payload
    const payload: APNSPayload = {
      aps: {
        alert: {
          title: "Products Found! 🎁",
          body: `We found ${productCount} great option${
            productCount === 1 ? "" : "s"
          } for "${ideaText}". Tap to see them!`,
        },
        sound: "default",
        badge: 1,
        "thread-id": "products-ready",
      },
      notification_type: "products_ready",
      general_gift_idea_id: generalGiftIdeaId,
      product_count: productCount,
    };

    // Send to all devices
    for (const token of deviceTokens as DeviceToken[]) {
      const response = await sendPushNotification(
        token.device_token,
        payload,
        token.is_sandbox
      );

      if (response.success) {
        results.sent++;
        console.log(
          `   ✅ [APNS] Sent to device ${token.device_token.substring(0, 8)}...`
        );
      } else {
        results.failed++;
        results.errors.push(
          `${token.device_token.substring(0, 8)}...: ${response.reason}`
        );
        console.log(
          `   ❌ [APNS] Failed to send to ${token.device_token.substring(
            0,
            8
          )}...: ${response.reason}`
        );
      }
    }

    console.log(
      `📊 [APNS] Products ready notification results: ${results.sent} sent, ${results.failed} failed`
    );

    return results;
  } catch (error) {
    console.error(
      "❌ [APNS] Error sending products ready notification:",
      error
    );
    results.errors.push(
      error instanceof Error ? error.message : "Unknown error"
    );
    return results;
  }
}

/**
 * Check if APNS is configured and available
 */
export function isAPNSConfigured(): boolean {
  return !!(
    apnsConfig.keyBase64 &&
    apnsConfig.keyId &&
    apnsConfig.teamId &&
    apnsConfig.bundleId
  );
}

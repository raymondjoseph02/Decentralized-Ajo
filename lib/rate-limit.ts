import { NextRequest, NextResponse } from 'next/server';
import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';

/**
 * Gets the client IP address from the request headers
 */
const getIP = (request: NextRequest): string => {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    return xff.split(',')[0].trim();
  }
  return '127.0.0.1';
};

/**
 * Helper to apply express-style middleware to Next.js Route Handlers
 */
async function applyMiddleware(
  limiter: RateLimitRequestHandler,
  request: NextRequest
): Promise<NextResponse | null> {
  return new Promise((resolve, reject) => {
    // Mocking Express req and res
    const mockReq: any = {
      ip: getIP(request),
      headers: Object.fromEntries(request.headers),
      method: request.method,
    };

    let responseSent = false;
    let statusCode = 200;
    const responseHeaders: Record<string, string> = {};
    let responseBody: any = null;

    const mockRes: any = {
      status: (code: number) => {
        statusCode = code;
        return mockRes;
      },
      set: (name: string, value: string) => {
        responseHeaders[name] = value;
        return mockRes;
      },
      setHeader: (name: string, value: string) => {
        responseHeaders[name] = value;
        return mockRes;
      },
      send: (body: any) => {
        if (!responseSent) {
          responseBody = body;
          responseSent = true;
          // When limiter calls send, it means the rate limit was hit
          const response = NextResponse.json(
            { 
              error: 'Too many requests', 
              message: typeof body === 'string' ? body : (body.message || 'Please try again later.') 
            }, 
            { 
              status: statusCode,
              headers: responseHeaders
            }
          );
          resolve(response);
        }
      },
      json: (body: any) => {
        if (!responseSent) {
          responseBody = body;
          responseSent = true;
          const response = NextResponse.json(body, { 
            status: statusCode,
            headers: responseHeaders
          });
          resolve(response);
        }
      },
      getHeader: (name: string) => responseHeaders[name],
    };

    // Note: express-rate-limit middleware(req, res, next)
    limiter(mockReq, mockRes, (err: any) => {
      if (err) return reject(err);
      if (!responseSent) {
        // If next() was called, it means we didn't hit the rate limit
        resolve(null);
      }
    });
  });
}

/**
 * Global API Rate Limiter
 * 100 requests per 15 minutes per IP
 */
export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again after 15 minutes',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Auth Rate Limiter (Login/Register)
 * 5 requests per 15 minutes per IP
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many authentication attempts, please try again after 15 minutes',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Circle Creation Rate Limiter
 * 10 requests per 15 minutes per IP
 */
export const circleCreationRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many circles created, please try again after 15 minutes',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Middleware execution wrapper for Route Handlers
 */
export async function checkRateLimit(
  limiter: RateLimitRequestHandler,
  request: NextRequest
): Promise<NextResponse | null> {
  return applyMiddleware(limiter, request);
}

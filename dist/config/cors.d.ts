/**
 * Single source of truth for CORS, shared by the Express app and Socket.IO so the
 * two can never disagree about who may connect.
 *
 * In development any loopback origin is accepted regardless of port: the dev server
 * does not always get the port it asks for (another process may hold it), and hard
 * coding one meant the API silently rejected the frontend whenever that happened.
 * Production stays restricted to the configured origins.
 */
export declare function isAllowedOrigin(origin: string | undefined | null): boolean;
export declare function logCorsPolicy(): void;
/** Origin checker in the shape the `cors` package and Socket.IO both accept. */
export declare function corsOriginCheck(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void): void;
//# sourceMappingURL=cors.d.ts.map
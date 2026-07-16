/** Cookie names for auth (shared by middleware + server). */
export const GUEST_COOKIE = "ncs_guest_id";
export const SESSION_COOKIE = "ncs_session";

/** Header middleware sets so the current request sees a freshly minted guest id. */
export const GUEST_ID_HEADER = "x-ncs-guest-id";

export const GUEST_ID_RE = /^guest_[a-f0-9]{32}$/;
export const USER_ID_RE = /^user_[a-f0-9]{32}$/;

export const GUEST_MAX_AGE_SEC = 60 * 60 * 24 * 400; // ~400 days
export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

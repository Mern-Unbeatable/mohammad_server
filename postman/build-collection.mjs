/**
 * Builds Lab-Unity.postman_collection.json from the known backend routes
 * and role/feature layout (Auth / Admin / Supplier / User).
 * Run: node build-collection.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OLD = JSON.parse(
  fs.readFileSync(path.join(__dirname, "Lab-Unity.postman_collection.json"), "utf8"),
);

/** Pull raw body JSON by matching URL suffix from the previous collection. */
const bodyByUrl = new Map();
(function indexBodies(items) {
  for (const i of items || []) {
    if (i.request?.body?.raw) {
      const raw = i.request.url?.raw || "";
      const pathOnly = raw.replace(/\{\{baseUrl\}\}/, "").split("?")[0];
      bodyByUrl.set(`${i.request.method} ${pathOnly}`, i.request.body);
    }
    if (i.item) indexBodies(i.item);
  }
})(OLD.item);

const jsonHeader = [{ key: "Content-Type", value: "application/json" }];

function bearerAuth(tokenVar) {
  return {
    type: "bearer",
    bearer: [{ key: "token", value: `{{${tokenVar}}}`, type: "string" }],
  };
}

function parseUrl(raw) {
  const withoutBase = raw.replace("{{baseUrl}}", "");
  const [pathPart, queryPart] = withoutBase.split("?");
  const pathSegments = pathPart.split("/").filter(Boolean);
  const query = queryPart
    ? queryPart.split("&").map((pair) => {
        const [key, value] = pair.split("=");
        return { key, value: value ?? "" };
      })
    : undefined;
  return {
    raw,
    host: ["{{baseUrl}}"],
    path: pathSegments,
    ...(query ? { query } : {}),
  };
}

function req({
  name,
  method,
  url,
  description,
  body,
  auth,
  header,
  event,
  disabled,
}) {
  const pathKey = `${method} ${url.replace("{{baseUrl}}", "").split("?")[0]}`;
  const resolvedBody =
    body === undefined ? bodyByUrl.get(pathKey) : body === null ? undefined : body;

  const item = {
    name,
    request: {
      method,
      header: header ?? (resolvedBody ? jsonHeader : []),
      url: parseUrl(url),
      description: description || undefined,
      ...(resolvedBody ? { body: resolvedBody } : {}),
      ...(auth === false
        ? { auth: { type: "noauth" } }
        : auth
          ? { auth }
          : {}),
    },
  };
  if (event) item.event = event;
  if (disabled) item.disabled = true;
  return item;
}

function folder(name, description, items, auth) {
  return {
    name,
    description,
    ...(auth ? { auth } : {}),
    item: items,
  };
}

const loginTests = [
  {
    listen: "test",
    script: {
      type: "text/javascript",
      exec: [
        "const json = pm.response.json();",
        "if (!json.data) return;",
        "const access = json.data.accessToken;",
        "const refresh = json.data.refreshToken;",
        "pm.collectionVariables.set('accessToken', access);",
        "pm.collectionVariables.set('refreshToken', refresh);",
        "const role = json.data.user?.role || json.data.role;",
        "if (role === 'ADMIN') pm.collectionVariables.set('adminToken', access);",
        "if (role === 'SUPPLIER') pm.collectionVariables.set('sellerToken', access);",
        "if (role === 'USER') pm.collectionVariables.set('customerToken', access);",
      ],
    },
  },
];

const authFolder = folder(
  "Auth",
  "Shared authentication for all roles. No Bearer token except Get Current User.",
  [
    req({
      name: "Register",
      method: "POST",
      url: "{{baseUrl}}/auth/register",
      auth: false,
      description:
        "Create a new account.\n\n**Auth:** none (rate-limited)\n**Body:** firstName, lastName, email, password, confirmPassword, profileType, acceptedTerms (+ optional profile fields)\n**Status:** 201",
    }),
    req({
      name: "Login",
      method: "POST",
      url: "{{baseUrl}}/auth/login",
      auth: false,
      event: loginTests,
      description:
        "Exchange credentials for tokens. Test script saves `accessToken` / `refreshToken` and mirrors into `adminToken` | `sellerToken` | `customerToken` based on role.\n\n**Auth:** none (rate-limited)\n**Status:** 200",
    }),
    req({
      name: "Refresh Token",
      method: "POST",
      url: "{{baseUrl}}/auth/refresh",
      auth: false,
      description:
        "Rotate access + refresh tokens.\n\n**Auth:** none\n**Body:** `{ refreshToken }`\n**Status:** 200",
    }),
    req({
      name: "Logout",
      method: "POST",
      url: "{{baseUrl}}/auth/logout",
      auth: false,
      description:
        "Revoke refresh token.\n\n**Auth:** none\n**Body:** `{ refreshToken }`\n**Status:** 200",
    }),
    req({
      name: "Get Current User",
      method: "GET",
      url: "{{baseUrl}}/auth/me",
      description:
        "JWT session summary (id, role, email). Distinct from `GET /users/me` (full profile).\n\n**Auth:** Bearer any role\n**Status:** 200",
    }),
  ],
);

const publicFolder = folder(
  "Public",
  "Unauthenticated / optional-auth endpoints used across roles.",
  [
    req({
      name: "Health Check",
      method: "GET",
      url: "{{baseUrl}}/health",
      auth: false,
      description: "**Auth:** none\n**Status:** 200",
    }),
    req({
      name: "List Blogs",
      method: "GET",
      url: "{{baseUrl}}/blogs?page=1&pageSize=10&category=diagnostics",
      auth: false,
      description:
        "Public blog list. Optional Bearer lets ADMIN see unpublished.\n\n**Query:** page, pageSize, sort, search, category\n**Status:** 200",
    }),
    req({
      name: "Get Blog by Slug",
      method: "GET",
      url: "{{baseUrl}}/blogs/{{blogSlug}}",
      auth: false,
      description: "**Auth:** none\n**Params:** slug\n**Status:** 200 | 404",
    }),
    req({
      name: "Get Subscription Plans",
      method: "GET",
      url: "{{baseUrl}}/subscriptions/plans",
      auth: false,
      description: "**Auth:** none\n**Status:** 200",
    }),
  ],
);

const adminAuth = bearerAuth("adminToken");

const adminFolder = folder(
  "Admin",
  "Admin panel surface. Folder auth uses `{{adminToken}}` (ADMIN role).\n\nSources: `server/src/modules/admin/*`, shared domains for moderation lists, `web/src/api/httpEndpoints.js` ADMIN.*, `docs/audits/features/admin-panel.md`.",
  [
    folder(
      "Dashboard",
      "Canonical: `GET /admin/dashboard`. There is **no** separate recent-activity endpoint — do not invent one.",
      [
        req({
          name: "Get Dashboard",
          method: "GET",
          url: "{{baseUrl}}/admin/dashboard",
          description:
            "Headline KPIs (active users, subscribers, revenue, jobs, listings).\n\n**Auth:** ADMIN\n**Status:** 200\n**Response:** `{ data: { stats: [{ id, label, value, currency? }] } }`",
        }),
      ],
      adminAuth,
    ),
    folder(
      "Statistics",
      "Canonical: `GET /admin/statistics`.",
      [
        req({
          name: "Get Statistics",
          method: "GET",
          url: "{{baseUrl}}/admin/statistics?year=2026",
          description:
            "12-month growth/revenue series.\n\n**Auth:** ADMIN\n**Query:** year (optional, 2000–2100)\n**Status:** 200\n**Response:** `{ data: { year, labels, series } }`",
        }),
      ],
      adminAuth,
    ),
    folder(
      "Settings",
      "Canonical: `/admin/settings*`.",
      [
        req({
          name: "Get All Settings",
          method: "GET",
          url: "{{baseUrl}}/admin/settings",
          description: "**Auth:** ADMIN\n**Status:** 200",
        }),
        req({
          name: "Get Setting by Key",
          method: "GET",
          url: "{{baseUrl}}/admin/settings/{{settingKey}}",
          description:
            "**Auth:** ADMIN\n**Params:** key\n**Status:** 200 | 404\n\nVariable `settingKey` example: `maintenance_mode`",
        }),
        req({
          name: "Upsert Setting",
          method: "PUT",
          url: "{{baseUrl}}/admin/settings/{{settingKey}}",
          body: {
            mode: "raw",
            raw: '{\n  "value": true\n}',
            options: { raw: { language: "json" } },
          },
          description:
            "**Auth:** ADMIN\n**Body:** `{ value: <any JSON> }`\n**Status:** 200",
        }),
      ],
      adminAuth,
    ),
    folder(
      "Users",
      "Mounted at `/users` (not `/admin/users`). ADMIN-only list/detail/status.",
      [
        req({
          name: "List Users",
          method: "GET",
          url: "{{baseUrl}}/users?page=1&pageSize=20&role=user&status=active",
          description:
            "**Auth:** ADMIN\n**Query:** page, pageSize, sort, search, role (user|supplier|admin), status (active|suspended|banned), plan (free|monthly|yearly)\n**Status:** 200",
        }),
        req({
          name: "Get User by ID",
          method: "GET",
          url: "{{baseUrl}}/users/{{userId}}",
          description: "**Auth:** ADMIN\n**Params:** id (uuid)\n**Status:** 200 | 404",
        }),
        req({
          name: "Update User Status",
          method: "PATCH",
          url: "{{baseUrl}}/users/{{userId}}/status",
          description:
            "**Auth:** ADMIN\n**Body:** `{ status: ACTIVE|SUSPENDED|BANNED, reason? }`\n**Status:** 200",
        }),
      ],
      adminAuth,
    ),
    folder(
      "Profile",
      "Same `/users/me*` routes as other roles (admin panel profile).",
      [
        req({
          name: "Get My Profile",
          method: "GET",
          url: "{{baseUrl}}/users/me",
          description: "**Auth:** any (use adminToken)\n**Status:** 200",
        }),
        req({
          name: "Update My Profile",
          method: "PATCH",
          url: "{{baseUrl}}/users/me",
          description:
            "**Auth:** any\n**Body:** optional firstName, lastName, title, company, country, location, phone, about, aboutExtended, avatarUrl, coverUrl\n**Status:** 200",
        }),
        req({
          name: "Change Password",
          method: "PATCH",
          url: "{{baseUrl}}/users/me/password",
          description:
            "**Auth:** any\n**Body:** currentPassword, newPassword, confirmPassword\n**Status:** 200",
        }),
      ],
      adminAuth,
    ),
    folder(
      "Blogs",
      "Canonical blogs module (`admin/blogs`). Public read + ADMIN write.",
      [
        req({
          name: "List Blogs",
          method: "GET",
          url: "{{baseUrl}}/blogs?page=1&pageSize=10",
          description:
            "With admin token, unpublished posts are included.\n\n**Auth:** optional / ADMIN preferred\n**Status:** 200",
        }),
        req({
          name: "Get Blog by Slug",
          method: "GET",
          url: "{{baseUrl}}/blogs/{{blogSlug}}",
          description: "**Auth:** none\n**Status:** 200 | 404",
        }),
        req({
          name: "Create Blog",
          method: "POST",
          url: "{{baseUrl}}/blogs",
          description:
            "**Auth:** ADMIN\n**Body:** title, category, excerpt, body, image?, readTime?, slug?, publish?\n**Status:** 201",
        }),
        req({
          name: "Update Blog",
          method: "PATCH",
          url: "{{baseUrl}}/blogs/{{blogId}}",
          description: "**Auth:** ADMIN\n**Params:** id (uuid)\n**Status:** 200",
        }),
        req({
          name: "Delete Blog",
          method: "DELETE",
          url: "{{baseUrl}}/blogs/{{blogId}}",
          description: "**Auth:** ADMIN\n**Status:** 200",
        }),
      ],
      adminAuth,
    ),
    folder(
      "Reports",
      "Canonical `admin/reports`. Create is any authenticated user (also under User/Reports).",
      [
        req({
          name: "List Reports",
          method: "GET",
          url: "{{baseUrl}}/reports?page=1&pageSize=20&status=pending",
          description:
            "**Auth:** ADMIN\n**Query:** pagination + status (pending|under_review|resolved)\n**Status:** 200",
        }),
        req({
          name: "Get Report Stats",
          method: "GET",
          url: "{{baseUrl}}/reports/stats",
          description: "**Auth:** ADMIN\n**Status:** 200",
        }),
        req({
          name: "Get Report by ID",
          method: "GET",
          url: "{{baseUrl}}/reports/{{reportId}}",
          description: "**Auth:** ADMIN\n**Status:** 200 | 404",
        }),
        req({
          name: "Update Report Status",
          method: "PATCH",
          url: "{{baseUrl}}/reports/{{reportId}}/status",
          description:
            "**Auth:** ADMIN\n**Body:** `{ status: PENDING|UNDER_REVIEW|RESOLVED }`\n**Status:** 200",
        }),
        req({
          name: "Moderate Report",
          method: "POST",
          url: "{{baseUrl}}/reports/{{reportId}}/moderate",
          description:
            "**Auth:** ADMIN\n**Body:** `{ action: WARN|SUSPEND|BAN|REMOVE_CONTENT|DISMISS, note? }`\n**Status:** 200",
        }),
      ],
      adminAuth,
    ),
    folder(
      "Advertisements",
      "Admin review surface. Canonical service: `supplier/advertisements`. Review is ADMIN-only.",
      [
        req({
          name: "List Advertisements",
          method: "GET",
          url: "{{baseUrl}}/advertisements?page=1&pageSize=20&status=PENDING",
          description:
            "Admin sees all ads.\n\n**Auth:** ADMIN\n**Query:** page, pageSize, status, category, mine\n**Status:** 200",
        }),
        req({
          name: "Get Advertisement by ID",
          method: "GET",
          url: "{{baseUrl}}/advertisements/{{adId}}",
          description: "**Auth:** authenticated\n**Status:** 200 | 404",
        }),
        req({
          name: "Review Advertisement",
          method: "PATCH",
          url: "{{baseUrl}}/advertisements/{{adId}}/review",
          description:
            "**Auth:** ADMIN\n**Body:** `{ status: ACTIVE|REJECTED|EXPIRED, rejectionReason? }`\n**Status:** 200",
        }),
      ],
      adminAuth,
    ),
    folder(
      "Marketplace",
      "Shared `/marketplace` domain (canonical `user/marketplace`). Admin uses list/detail/delete per frontend ADMIN.MARKETPLACE.",
      [
        req({
          name: "List Listings",
          method: "GET",
          url: "{{baseUrl}}/marketplace?page=1&pageSize=12",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Get Listing by ID",
          method: "GET",
          url: "{{baseUrl}}/marketplace/{{listingId}}",
          description: "**Auth:** authenticated\n**Status:** 200 | 404",
        }),
        req({
          name: "Delete Listing",
          method: "DELETE",
          url: "{{baseUrl}}/marketplace/{{listingId}}",
          description:
            "**Auth:** authenticated (ownership/admin enforced in service)\n**Status:** 200",
        }),
      ],
      adminAuth,
    ),
    folder(
      "Recruitment",
      "Shared `/recruitment` (canonical `user/recruitment`).",
      [
        req({
          name: "List Jobs",
          method: "GET",
          url: "{{baseUrl}}/recruitment?page=1&pageSize=10",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Get Job by ID",
          method: "GET",
          url: "{{baseUrl}}/recruitment/{{jobId}}",
          description: "**Auth:** authenticated\n**Status:** 200 | 404",
        }),
        req({
          name: "List Job Applications",
          method: "GET",
          url: "{{baseUrl}}/recruitment/{{jobId}}/applications",
          description:
            "**Auth:** authenticated (owner/admin in service)\n**Status:** 200",
        }),
        req({
          name: "Delete Job",
          method: "DELETE",
          url: "{{baseUrl}}/recruitment/{{jobId}}",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
      ],
      adminAuth,
    ),
    folder(
      "General",
      "Shared `/general` (canonical `user/general`).",
      [
        req({
          name: "List General Posts",
          method: "GET",
          url: "{{baseUrl}}/general?page=1&pageSize=10",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Get General Post by ID",
          method: "GET",
          url: "{{baseUrl}}/general/{{generalPostId}}",
          description: "**Auth:** authenticated\n**Status:** 200 | 404",
        }),
        req({
          name: "Delete General Post",
          method: "DELETE",
          url: "{{baseUrl}}/general/{{generalPostId}}",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
      ],
      adminAuth,
    ),
  ],
  adminAuth,
);

const supplierAuth = bearerAuth("sellerToken");

const supplierFolder = folder(
  "Supplier",
  "Supplier panel surface. Folder auth uses `{{sellerToken}}` (SUPPLIER role).\n\n**Note:** There is no dedicated `/supplier/dashboard` HTTP API — the frontend dashboard composes advertisements + notifications (see Dashboard folder).",
  [
    folder(
      "Dashboard",
      "⚠️ No dedicated dashboard endpoint exists (by design). These requests mirror what the supplier UI composes.",
      [
        req({
          name: "List My Advertisements",
          method: "GET",
          url: "{{baseUrl}}/advertisements?mine=true&page=1&pageSize=10",
          description:
            "Supplier-owned ads for dashboard cards.\n\n**Auth:** SUPPLIER\n**Status:** 200",
        }),
        req({
          name: "List Notifications",
          method: "GET",
          url: "{{baseUrl}}/notifications?page=1&pageSize=20",
          description:
            "Notifications feed used on supplier dashboard.\n\n**Auth:** authenticated\n**Status:** 200",
        }),
      ],
      supplierAuth,
    ),
    folder(
      "Advertisements",
      "Canonical `supplier/advertisements`. Create requires SUPPLIER.",
      [
        req({
          name: "List Advertisements",
          method: "GET",
          url: "{{baseUrl}}/advertisements?mine=true&page=1&pageSize=10",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Create Advertisement",
          method: "POST",
          url: "{{baseUrl}}/advertisements",
          description:
            "**Auth:** SUPPLIER\n**Body:** title, category (PRODUCT|SERVICE|PROMO|WEBINAR), description, durationDays (7|14|30), optional media/price/contact/location/event fields\n**Status:** 201",
        }),
        req({
          name: "Get Advertisement by ID",
          method: "GET",
          url: "{{baseUrl}}/advertisements/{{adId}}",
          description: "**Auth:** authenticated\n**Status:** 200 | 404",
        }),
        req({
          name: "Update Advertisement",
          method: "PATCH",
          url: "{{baseUrl}}/advertisements/{{adId}}",
          description: "**Auth:** SUPPLIER\n**Status:** 200",
        }),
        req({
          name: "Delete Advertisement",
          method: "DELETE",
          url: "{{baseUrl}}/advertisements/{{adId}}",
          description: "**Auth:** authenticated (ownership in service)\n**Status:** 200",
        }),
      ],
      supplierAuth,
    ),
    folder(
      "Marketplace",
      "Shared marketplace domain — supplier CRUD (frontend SUPPLIER.MARKETPLACE).",
      [
        req({
          name: "List Listings",
          method: "GET",
          url: "{{baseUrl}}/marketplace?mine=true&page=1&pageSize=10",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Create Listing",
          method: "POST",
          url: "{{baseUrl}}/marketplace",
          description:
            "**Auth:** authenticated\n**Body:** title, description, condition, category, price, year?, location?, images?\n**Status:** 201",
        }),
        req({
          name: "Get Listing by ID",
          method: "GET",
          url: "{{baseUrl}}/marketplace/{{listingId}}",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Update Listing",
          method: "PATCH",
          url: "{{baseUrl}}/marketplace/{{listingId}}",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Delete Listing",
          method: "DELETE",
          url: "{{baseUrl}}/marketplace/{{listingId}}",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
      ],
      supplierAuth,
    ),
    folder(
      "Recruitment",
      "Shared recruitment domain — supplier job management.",
      [
        req({
          name: "List Jobs",
          method: "GET",
          url: "{{baseUrl}}/recruitment?mine=true&page=1&pageSize=10",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Create Job",
          method: "POST",
          url: "{{baseUrl}}/recruitment",
          description: "**Auth:** authenticated\n**Status:** 201",
        }),
        req({
          name: "Get Job by ID",
          method: "GET",
          url: "{{baseUrl}}/recruitment/{{jobId}}",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Update Job",
          method: "PATCH",
          url: "{{baseUrl}}/recruitment/{{jobId}}",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Delete Job",
          method: "DELETE",
          url: "{{baseUrl}}/recruitment/{{jobId}}",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "List Job Applications",
          method: "GET",
          url: "{{baseUrl}}/recruitment/{{jobId}}/applications",
          description: "**Auth:** authenticated (owner)\n**Status:** 200",
        }),
      ],
      supplierAuth,
    ),
    folder(
      "General",
      "Shared general posts — supplier CRUD.",
      [
        req({
          name: "List General Posts",
          method: "GET",
          url: "{{baseUrl}}/general?mine=true&page=1&pageSize=10",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Create General Post",
          method: "POST",
          url: "{{baseUrl}}/general",
          description:
            "**Auth:** authenticated\n**Body:** type NEWS|DOCUMENT, title, … (documentUrl required for DOCUMENT)\n**Status:** 201",
        }),
        req({
          name: "Get General Post by ID",
          method: "GET",
          url: "{{baseUrl}}/general/{{generalPostId}}",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Update General Post",
          method: "PATCH",
          url: "{{baseUrl}}/general/{{generalPostId}}",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Delete General Post",
          method: "DELETE",
          url: "{{baseUrl}}/general/{{generalPostId}}",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
      ],
      supplierAuth,
    ),
    folder(
      "Blogs",
      "Read-only blogs for supplier (re-export of admin/blogs public read).",
      [
        req({
          name: "List Blogs",
          method: "GET",
          url: "{{baseUrl}}/blogs?page=1&pageSize=10",
          description: "**Auth:** optional\n**Status:** 200",
        }),
        req({
          name: "Get Blog by Slug",
          method: "GET",
          url: "{{baseUrl}}/blogs/{{blogSlug}}",
          description: "**Auth:** none\n**Status:** 200",
        }),
      ],
      supplierAuth,
    ),
    folder(
      "Contacts",
      "Canonical `supplier/contacts` (mount `/contacts`).",
      [
        req({
          name: "List Contacts",
          method: "GET",
          url: "{{baseUrl}}/contacts?page=1&pageSize=20",
          description: "**Auth:** authenticated\n**Query:** pagination + country?\n**Status:** 200",
        }),
        req({
          name: "Get Contact by ID",
          method: "GET",
          url: "{{baseUrl}}/contacts/{{connectionId}}",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Send Connection Request",
          method: "POST",
          url: "{{baseUrl}}/contacts/request",
          description: "**Auth:** authenticated\n**Body:** `{ addresseeId }`\n**Status:** 201",
        }),
        req({
          name: "Accept Connection",
          method: "PATCH",
          url: "{{baseUrl}}/contacts/{{connectionId}}/accept",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Decline Connection",
          method: "PATCH",
          url: "{{baseUrl}}/contacts/{{connectionId}}/decline",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Remove Connection",
          method: "DELETE",
          url: "{{baseUrl}}/contacts/{{connectionId}}",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
      ],
      supplierAuth,
    ),
    folder(
      "Notifications",
      "Canonical `supplier/notifications`.",
      [
        req({
          name: "List Notifications",
          method: "GET",
          url: "{{baseUrl}}/notifications?page=1&pageSize=20",
          description: "**Auth:** authenticated\n**Query:** unread?\n**Status:** 200",
        }),
        req({
          name: "Mark All as Read",
          method: "PATCH",
          url: "{{baseUrl}}/notifications/read-all",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Mark Notification as Read",
          method: "PATCH",
          url: "{{baseUrl}}/notifications/{{notificationId}}/read",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Delete Notification",
          method: "DELETE",
          url: "{{baseUrl}}/notifications/{{notificationId}}",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
      ],
      supplierAuth,
    ),
    folder(
      "Messages",
      "Shared messages domain (frontend SUPPLIER.MESSAGES).",
      [
        req({
          name: "List Conversations",
          method: "GET",
          url: "{{baseUrl}}/messages?type=direct",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Start Direct Message",
          method: "POST",
          url: "{{baseUrl}}/messages/direct",
          description: "**Auth:** authenticated\n**Body:** `{ participantId, message }`\n**Status:** 201",
        }),
        req({
          name: "Create Group Conversation",
          method: "POST",
          url: "{{baseUrl}}/messages/group",
          description: "**Auth:** authenticated\n**Body:** `{ name, participantIds[] }`\n**Status:** 201",
        }),
        req({
          name: "Get Messages in Conversation",
          method: "GET",
          url: "{{baseUrl}}/messages/{{conversationId}}/messages?page=1&pageSize=30",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Send Message",
          method: "POST",
          url: "{{baseUrl}}/messages/{{conversationId}}/messages",
          description: "**Auth:** authenticated\n**Body:** `{ body }`\n**Status:** 201",
        }),
      ],
      supplierAuth,
    ),
    folder(
      "Profile",
      "Same `/users/me*` as other roles.",
      [
        req({
          name: "Get My Profile",
          method: "GET",
          url: "{{baseUrl}}/users/me",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Update My Profile",
          method: "PATCH",
          url: "{{baseUrl}}/users/me",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Change Password",
          method: "PATCH",
          url: "{{baseUrl}}/users/me/password",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
      ],
      supplierAuth,
    ),
    folder(
      "Uploads",
      "Shared infra `/uploads` (frontend SUPPLIER.UPLOADS).",
      [
        req({
          name: "Upload Single File",
          method: "POST",
          url: "{{baseUrl}}/uploads",
          header: [],
          body: {
            mode: "formdata",
            formdata: [
              {
                key: "file",
                type: "file",
                src: [],
                description: "Multipart field name must be `file`",
              },
            ],
          },
          description: "**Auth:** authenticated\n**Body:** multipart `file`\n**Status:** 201",
        }),
        req({
          name: "Upload Multiple Files",
          method: "POST",
          url: "{{baseUrl}}/uploads/multiple",
          header: [],
          body: {
            mode: "formdata",
            formdata: [
              {
                key: "files",
                type: "file",
                src: [],
                description: "Multipart field name must be `files` (max 12)",
              },
            ],
          },
          description: "**Auth:** authenticated\n**Body:** multipart `files`\n**Status:** 201",
        }),
      ],
      supplierAuth,
    ),
  ],
  supplierAuth,
);

const userAuth = bearerAuth("customerToken");

const userFolder = folder(
  "User",
  "Customer / user app surface. Folder auth uses `{{customerToken}}` (USER role).\n\nCanonical modules under `server/src/modules/user/*` plus shared contacts/notifications/ads browse.",
  [
    folder(
      "Profile",
      "Canonical `user/profile` — `/users/me*`.",
      [
        req({
          name: "Get My Profile",
          method: "GET",
          url: "{{baseUrl}}/users/me",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Update My Profile",
          method: "PATCH",
          url: "{{baseUrl}}/users/me",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Change Password",
          method: "PATCH",
          url: "{{baseUrl}}/users/me/password",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
      ],
      userAuth,
    ),
    folder(
      "Feed",
      "Canonical `user/feed`.",
      [
        req({
          name: "List Feed",
          method: "GET",
          url: "{{baseUrl}}/feed?page=1&pageSize=10",
          description: "**Auth:** authenticated\n**Query:** type?, mine?\n**Status:** 200",
        }),
        req({
          name: "Create Post",
          method: "POST",
          url: "{{baseUrl}}/feed",
          description: "**Auth:** authenticated\n**Status:** 201",
        }),
        req({
          name: "Get Post by ID",
          method: "GET",
          url: "{{baseUrl}}/feed/{{postId}}",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Update Post",
          method: "PATCH",
          url: "{{baseUrl}}/feed/{{postId}}",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Delete Post",
          method: "DELETE",
          url: "{{baseUrl}}/feed/{{postId}}",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Add Comment",
          method: "POST",
          url: "{{baseUrl}}/feed/{{postId}}/comments",
          description: "**Auth:** authenticated\n**Body:** `{ content }`\n**Status:** 201",
        }),
        req({
          name: "Delete Comment",
          method: "DELETE",
          url: "{{baseUrl}}/feed/{{postId}}/comments/{{commentId}}",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "React to Post",
          method: "POST",
          url: "{{baseUrl}}/feed/{{postId}}/reactions",
          description:
            "**Auth:** authenticated\n**Body:** `{ type: LIKE|LOVE|CELEBRATE|SUPPORT|INSIGHTFUL|CURIOUS }`\n**Status:** 200",
        }),
      ],
      userAuth,
    ),
    folder(
      "Contacts",
      "Re-export of `supplier/contacts`.",
      [
        req({
          name: "List Contacts",
          method: "GET",
          url: "{{baseUrl}}/contacts?page=1&pageSize=20",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Get Contact by ID",
          method: "GET",
          url: "{{baseUrl}}/contacts/{{connectionId}}",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Send Connection Request",
          method: "POST",
          url: "{{baseUrl}}/contacts/request",
          description: "**Auth:** authenticated\n**Status:** 201",
        }),
        req({
          name: "Accept Connection",
          method: "PATCH",
          url: "{{baseUrl}}/contacts/{{connectionId}}/accept",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Decline Connection",
          method: "PATCH",
          url: "{{baseUrl}}/contacts/{{connectionId}}/decline",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Remove Connection",
          method: "DELETE",
          url: "{{baseUrl}}/contacts/{{connectionId}}",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
      ],
      userAuth,
    ),
    folder(
      "Marketplace",
      "Browse + save (frontend USER.MARKETPLACE). Create/update live under Supplier when posting inventory.",
      [
        req({
          name: "Browse Listings",
          method: "GET",
          url: "{{baseUrl}}/marketplace?page=1&pageSize=12",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Get Listing by ID",
          method: "GET",
          url: "{{baseUrl}}/marketplace/{{listingId}}",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Save / Unsave Listing",
          method: "POST",
          url: "{{baseUrl}}/marketplace/{{listingId}}/save",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
      ],
      userAuth,
    ),
    folder(
      "Recruitment",
      "Browse + apply (frontend USER.RECRUITMENT).",
      [
        req({
          name: "Browse Jobs",
          method: "GET",
          url: "{{baseUrl}}/recruitment?page=1&pageSize=10",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Get Job by ID",
          method: "GET",
          url: "{{baseUrl}}/recruitment/{{jobId}}",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Apply for Job",
          method: "POST",
          url: "{{baseUrl}}/recruitment/{{jobId}}/apply",
          description: "**Auth:** authenticated\n**Body:** `{ coverLetter? }`\n**Status:** 201",
        }),
      ],
      userAuth,
    ),
    folder(
      "General",
      "User general posts CRUD (frontend USER.GENERAL).",
      [
        req({
          name: "List General Posts",
          method: "GET",
          url: "{{baseUrl}}/general?page=1&pageSize=10",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Create General Post",
          method: "POST",
          url: "{{baseUrl}}/general",
          description: "**Auth:** authenticated\n**Status:** 201",
        }),
        req({
          name: "Get General Post by ID",
          method: "GET",
          url: "{{baseUrl}}/general/{{generalPostId}}",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Update General Post",
          method: "PATCH",
          url: "{{baseUrl}}/general/{{generalPostId}}",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Delete General Post",
          method: "DELETE",
          url: "{{baseUrl}}/general/{{generalPostId}}",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
      ],
      userAuth,
    ),
    folder(
      "Messages",
      "Canonical `user/messages`.",
      [
        req({
          name: "List Conversations",
          method: "GET",
          url: "{{baseUrl}}/messages?type=direct",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Start Direct Message",
          method: "POST",
          url: "{{baseUrl}}/messages/direct",
          description: "**Auth:** authenticated\n**Status:** 201",
        }),
        req({
          name: "Create Group Conversation",
          method: "POST",
          url: "{{baseUrl}}/messages/group",
          description: "**Auth:** authenticated\n**Status:** 201",
        }),
        req({
          name: "Get Messages in Conversation",
          method: "GET",
          url: "{{baseUrl}}/messages/{{conversationId}}/messages?page=1&pageSize=30",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Send Message",
          method: "POST",
          url: "{{baseUrl}}/messages/{{conversationId}}/messages",
          description: "**Auth:** authenticated\n**Status:** 201",
        }),
      ],
      userAuth,
    ),
    folder(
      "Notifications",
      "Re-export of `supplier/notifications`.",
      [
        req({
          name: "List Notifications",
          method: "GET",
          url: "{{baseUrl}}/notifications?page=1&pageSize=20",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Mark All as Read",
          method: "PATCH",
          url: "{{baseUrl}}/notifications/read-all",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Mark Notification as Read",
          method: "PATCH",
          url: "{{baseUrl}}/notifications/{{notificationId}}/read",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Delete Notification",
          method: "DELETE",
          url: "{{baseUrl}}/notifications/{{notificationId}}",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
      ],
      userAuth,
    ),
    folder(
      "Advertisements",
      "Browse active ads + engagement tracking (frontend USER.ADVERTISEMENTS).",
      [
        req({
          name: "Browse Active Advertisements",
          method: "GET",
          url: "{{baseUrl}}/advertisements/active?page=1&pageSize=10",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Track Ad Engagement",
          method: "POST",
          url: "{{baseUrl}}/advertisements/{{adId}}/track/{{metric}}",
          description:
            "**Auth:** authenticated\n**Params:** id, metric (`clicks` or other → counted as views)\n**Status:** 200\n\nSet collection var `metric` to `clicks` or `views`.",
        }),
      ],
      userAuth,
    ),
    folder(
      "Subscriptions",
      "Canonical `user/subscriptions`. Plans also under Public.",
      [
        req({
          name: "Get My Subscription",
          method: "GET",
          url: "{{baseUrl}}/subscriptions/me",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
        req({
          name: "Subscribe to Plan",
          method: "POST",
          url: "{{baseUrl}}/subscriptions/subscribe",
          description:
            "**Auth:** authenticated\n**Body:** `{ plan: MONTHLY|YEARLY, paymentMethod? }`\n**Status:** 200",
        }),
        req({
          name: "Cancel Subscription",
          method: "POST",
          url: "{{baseUrl}}/subscriptions/cancel",
          description: "**Auth:** authenticated\n**Status:** 200",
        }),
      ],
      userAuth,
    ),
    folder(
      "Reports",
      "Any authenticated user can file a report (`POST /reports`).",
      [
        req({
          name: "Submit Report",
          method: "POST",
          url: "{{baseUrl}}/reports",
          description:
            "**Auth:** authenticated\n**Body:** targetType, reason, optional targetId/reportedUserId/targetSnippet/reasonDetail\n**Status:** 201",
        }),
      ],
      userAuth,
    ),
    folder(
      "Blogs",
      "Public blog read (frontend PUBLIC.BLOGS / user blogs re-export).",
      [
        req({
          name: "List Blogs",
          method: "GET",
          url: "{{baseUrl}}/blogs?page=1&pageSize=10",
          auth: false,
          description: "**Auth:** none\n**Status:** 200",
        }),
        req({
          name: "Get Blog by Slug",
          method: "GET",
          url: "{{baseUrl}}/blogs/{{blogSlug}}",
          auth: false,
          description: "**Auth:** none\n**Status:** 200",
        }),
      ],
    ),
    folder(
      "Uploads",
      "Shared infra (frontend USER.UPLOADS).",
      [
        req({
          name: "Upload Single File",
          method: "POST",
          url: "{{baseUrl}}/uploads",
          header: [],
          body: {
            mode: "formdata",
            formdata: [{ key: "file", type: "file", src: [] }],
          },
          description: "**Auth:** authenticated\n**Status:** 201",
        }),
        req({
          name: "Upload Multiple Files",
          method: "POST",
          url: "{{baseUrl}}/uploads/multiple",
          header: [],
          body: {
            mode: "formdata",
            formdata: [{ key: "files", type: "file", src: [] }],
          },
          description: "**Auth:** authenticated\n**Status:** 201",
        }),
      ],
      userAuth,
    ),
  ],
  userAuth,
);

const collection = {
  info: {
    name: "Lab Unity API",
    description: [
      "Role + feature organized collection matching frontend (`web/src/api/httpEndpoints.js`) and backend modules (`server/src/modules/{admin,supplier,user}`).",
      "",
      "## Structure",
      "- **Auth** — register / login / refresh / logout / auth me",
      "- **Public** — health, blog read, subscription plans",
      "- **Admin** — dashboard, statistics, settings, users, profile, blogs, reports, ads review, marketplace/recruitment/general moderation",
      "- **Supplier** — ads, marketplace, recruitment, general, blogs (read), contacts, notifications, messages, profile, uploads; Dashboard = composed requests only",
      "- **User** — profile, feed, contacts, marketplace browse, recruitment apply, general, messages, notifications, ads browse, subscriptions, reports, blogs, uploads",
      "",
      "## Variables",
      "`baseUrl` (default `http://localhost:4000/api/v1`), `accessToken`, `adminToken`, `sellerToken`, `customerToken`, plus entity IDs.",
      "",
      "## Removed / not invented",
      "- Old nested **Dashboard > Admin/Supplier/Customer** mega-folder (duplicated other folders) — removed.",
      "- Duplicate **Platform Settings** under Admin (kept under Settings only).",
      "- **No** Supplier `GET /dashboard` or Admin “recent activity” — those APIs do not exist.",
      "- Frontend `ADMIN.MANAGE_USERS` → `/admin/users` is **not** a real route (users are under `/users`). Marked by omission.",
      "",
      "## Auth headers",
      "Collection default Bearer `{{accessToken}}`. Role folders override with `adminToken` / `sellerToken` / `customerToken`. Login test script fills the matching role token when `user.role` is present in the login response.",
    ].join("\n"),
    schema:
      "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    _postman_id: OLD.info?._postman_id,
  },
  auth: bearerAuth("accessToken"),
  variable: [
    { key: "baseUrl", value: "http://localhost:4000/api/v1" },
    { key: "accessToken", value: "" },
    { key: "refreshToken", value: "" },
    { key: "adminToken", value: "" },
    { key: "sellerToken", value: "" },
    { key: "customerToken", value: "" },
    { key: "userId", value: "" },
    { key: "postId", value: "" },
    { key: "commentId", value: "" },
    { key: "listingId", value: "" },
    { key: "jobId", value: "" },
    { key: "blogSlug", value: "" },
    { key: "blogId", value: "" },
    { key: "connectionId", value: "" },
    { key: "conversationId", value: "" },
    { key: "notificationId", value: "" },
    { key: "adId", value: "" },
    { key: "reportId", value: "" },
    { key: "generalPostId", value: "" },
    { key: "settingKey", value: "maintenance_mode" },
    { key: "metric", value: "clicks" },
  ],
  item: [authFolder, publicFolder, adminFolder, supplierFolder, userFolder],
};

const outPath = path.join(__dirname, "Lab-Unity.postman_collection.json");
fs.writeFileSync(outPath, JSON.stringify(collection, null, 2) + "\n");

// count requests
let count = 0;
(function walk(items) {
  for (const i of items) {
    if (i.request) count++;
    else if (i.item) walk(i.item);
  }
})(collection.item);

console.log(`Wrote ${outPath} with ${count} requests`);

# Lab Unity Postman collection

Collection file: [`Lab-Unity.postman_collection.json`](./Lab-Unity.postman_collection.json)

Organized to match frontend role features (`web/src/api/httpEndpoints.js`) and backend modules (`server/src/modules/{admin,supplier,user}`).

## Folder map

```text
Auth/
Public/
Admin/
  Dashboard/ Statistics/ Settings/ Users/ Profile/
  Blogs/ Reports/ Advertisements/
  Marketplace/ Recruitment/ General/
Supplier/
  Dashboard/   ← composed only (no dedicated API)
  Advertisements/ Marketplace/ Recruitment/ General/
  Blogs/ Contacts/ Notifications/ Messages/ Profile/ Uploads/
User/
  Profile/ Feed/ Contacts/ Marketplace/ Recruitment/ General/
  Messages/ Notifications/ Advertisements/ Subscriptions/
  Reports/ Blogs/ Uploads/
```

## Variables

| Variable | Purpose |
|----------|---------|
| `baseUrl` | Default `http://localhost:4000/api/v1` |
| `accessToken` | Collection-default Bearer |
| `adminToken` / `sellerToken` / `customerToken` | Role-folder Bearer overrides |
| `userId`, `adId`, `blogId`, … | Path params |
| `settingKey` | Admin settings key (default `maintenance_mode`) |
| `metric` | Ad track metric (`clicks` / `views`) |

Login’s test script saves tokens and mirrors into the matching role token when `data.user.role` is present.

## Source-of-truth notes

- **Do not invent APIs.** Supplier Dashboard has no `/dashboard` route — folder documents the composed `GET /advertisements?mine=true` + `GET /notifications` used by the UI.
- Frontend `ADMIN.MANAGE_USERS` → `/admin/users` is **not** implemented; admin user APIs are `GET/PATCH /users…`.
- Removed outdated duplicates: nested Dashboard mega-folder and duplicate Platform Settings under Admin.
- Regenerator: `node build-collection.mjs` (reuses JSON bodies from the previous collection by method+path).

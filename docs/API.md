# Lab Unity API Reference

Base URL: `{{PUBLIC_URL}}{{API_PREFIX}}` — default `http://localhost:4000/api/v1`.

Authenticated endpoints require `Authorization: Bearer <accessToken>`.

List endpoints accept common query params: `page` (default 1), `pageSize` (default 12, max 100), `sort` (`asc` | `desc`, default `desc`), and `search`.

---

## Auth — `/auth`

| Method | Path        | Auth   | Description                           |
| ------ | ----------- | ------ | ------------------------------------- |
| POST   | `/register` | Public | Register (returns user + token pair)  |
| POST   | `/login`    | Public | Login                                 |
| POST   | `/refresh`  | Public | Rotate refresh token → new token pair |
| POST   | `/logout`   | Public | Revoke a refresh token                |
| POST   | `/forgot-password` | Public | Email a password reset link    |
| POST   | `/reset-password`  | Public | Reset password with emailed token (revokes sessions) |
| GET    | `/me`       | Bearer | Current authenticated user            |

**Register body**

```json
{
  "firstName": "Élise",
  "lastName": "Moreau",
  "email": "elise@lab.com",
  "password": "Str0ng!pass",
  "confirmPassword": "Str0ng!pass",
  "profileType": "laboratory",
  "jobTitle": "QC Manager",
  "company": "Novagen",
  "country": "France",
  "phone": "+33...",
  "professionalInfo": "...",
  "acceptedTerms": true
}
```

**Forgot / reset password**

`POST /forgot-password` with `{ "email": "elise@lab.com" }` always returns
`200 { "message": "If an account exists for that email, a password reset link has been sent." }`
so registered emails can't be discovered. The email links to
`{CLIENT_URL}/reset-password?token=<token>`; issuing a new link invalidates
older unused ones. Configure `SMTP_*` / `MAIL_FROM` to send real emails —
without `SMTP_HOST` the email is logged to the server console (development
only; production throws and logs an error).

`POST /reset-password` body:

```json
{
  "token": "<token from email>",
  "password": "N3w!pass",
  "confirmPassword": "N3w!pass"
}
```

Tokens are single-use and expire after `PASSWORD_RESET_TTL_MINUTES`
(default 30). Invalid, used or expired tokens return `400 BAD_REQUEST`.
A successful reset revokes all refresh tokens (every session signs out).
Both endpoints share the auth rate limiter.

---

## Users & profile — `/users`

| Method | Path           | Auth   | Description                                  |
| ------ | -------------- | ------ | -------------------------------------------- |
| GET    | `/me`          | Bearer | Own account + profile + subscription         |
| PATCH  | `/me`          | Bearer | Update own profile                           |
| PATCH  | `/me/password` | Bearer | Change password (revokes sessions)           |
| GET    | `/`            | Admin  | List users (`role`,`status`,`plan`,`search`) |
| GET    | `/:id`         | Admin  | User detail                                  |
| PATCH  | `/:id/status`  | Admin  | Set `ACTIVE`/`SUSPENDED`/`BANNED`            |

---

## Contacts / connections — `/contacts`

| Method | Path           | Auth   | Description                                                 |
| ------ | -------------- | ------ | ----------------------------------------------------------- |
| GET    | `/`            | Bearer | Member directory (`country`,`search`) with connection state |
| GET    | `/:id`         | Bearer | Contact profile                                             |
| POST   | `/request`     | Bearer | Send connection request `{ addresseeId }`                   |
| PATCH  | `/:id/accept`  | Bearer | Accept a request                                            |
| PATCH  | `/:id/decline` | Bearer | Decline a request                                           |
| DELETE | `/:id`         | Bearer | Remove a connection                                         |

---

## Feed — `/feed`

| Method | Path                       | Auth        | Description                                        |
| ------ | -------------------------- | ----------- | -------------------------------------------------- |
| GET    | `/`                        | Bearer      | List posts (`type`,`mine`,`search`)                |
| POST   | `/`                        | Bearer      | Create post (`QUESTION`/`INFORMATION`/`SUPPLIERS`) |
| GET    | `/:id`                     | Bearer      | Post detail with comments                          |
| PATCH  | `/:id`                     | Owner       | Edit post                                          |
| DELETE | `/:id`                     | Owner/Admin | Delete post                                        |
| POST   | `/:id/comments`            | Bearer      | Add comment                                        |
| DELETE | `/:id/comments/:commentId` | Owner/Admin | Delete comment                                     |
| POST   | `/:id/reactions`           | Bearer      | Toggle reaction `{ type }`                         |

---

## Marketplace — `/marketplace`

| Method | Path        | Auth        | Description                                                                          |
| ------ | ----------- | ----------- | ------------------------------------------------------------------------------------ |
| GET    | `/`         | Bearer      | List listings (`category`,`condition`,`minPrice`,`maxPrice`,`mine`,`saved`,`search`) |
| POST   | `/`         | Bearer      | Create listing                                                                       |
| GET    | `/:id`      | Bearer      | Listing detail                                                                       |
| PATCH  | `/:id`      | Owner/Admin | Update listing                                                                       |
| DELETE | `/:id`      | Owner/Admin | Delete listing                                                                       |
| POST   | `/:id/save` | Bearer      | Toggle saved/bookmark                                                                |

Categories: `CHROMATOGRAPHY`, `SPECTROSCOPY`, `INCUBATION`, `CENTRIFUGATION`, `WEIGHING`, `SAFETY`, `CONSUMABLES`, `MICROSCOPY`. Conditions: `NEW`, `LIKE_NEW`, `GOOD`, `REFURBISHED`, `FOR_PARTS`.

---

## Recruitment — `/recruitment`

| Method | Path                | Auth        | Description                                                  |
| ------ | ------------------- | ----------- | ------------------------------------------------------------ |
| GET    | `/`                 | Bearer      | List jobs (`level`,`employmentType`,`since`,`mine`,`search`) |
| POST   | `/`                 | Bearer      | Create job                                                   |
| GET    | `/:id`              | Bearer      | Job detail                                                   |
| PATCH  | `/:id`              | Owner/Admin | Update job                                                   |
| DELETE | `/:id`              | Owner/Admin | Delete job                                                   |
| POST   | `/:id/apply`        | Bearer      | Apply `{ coverLetter? }`                                     |
| GET    | `/:id/applications` | Owner/Admin | List applicants                                              |

`employmentType`: `FULL_TIME`,`PART_TIME`,`CONTRACT`,`INTERNSHIP`. `level`: `ENTRY_LEVEL`,`MID_LEVEL`,`SENIOR`. `since`: `7d`,`30d`,`90d`.

---

## General posts — `/general`

| Method | Path   | Auth        | Description               |
| ------ | ------ | ----------- | ------------------------- | -------------------------- |
| GET    | `/`    | Bearer      | List (`type=news          | document`,`mine`,`search`) |
| POST   | `/`    | Bearer      | Create news/document post |
| GET    | `/:id` | Bearer      | Detail                    |
| PATCH  | `/:id` | Owner/Admin | Update                    |
| DELETE | `/:id` | Owner/Admin | Delete                    |

---

## Blogs — `/blogs`

| Method | Path     | Auth   | Description                                   |
| ------ | -------- | ------ | --------------------------------------------- |
| GET    | `/`      | Public | List published articles (`category`,`search`) |
| GET    | `/:slug` | Public | Article by slug                               |
| POST   | `/`      | Admin  | Create article                                |
| PATCH  | `/:id`   | Admin  | Update article                                |
| DELETE | `/:id`   | Admin  | Delete article                                |

---

## Messages — `/messages`

| Method | Path            | Auth   | Description                                       |
| ------ | --------------- | ------ | ------------------------------------------------- |
| GET    | `/`             | Bearer | List conversations (`type`,`search`)              |
| POST   | `/direct`       | Bearer | Start/continue a 1:1 `{ participantId, message }` |
| POST   | `/group`        | Bearer | Create group `{ name, participantIds }`           |
| GET    | `/:id/messages` | Member | Paged message history                             |
| POST   | `/:id/messages` | Member | Send a message `{ body }`                         |

---

## Notifications — `/notifications`

| Method | Path        | Auth   | Description                    |
| ------ | ----------- | ------ | ------------------------------ |
| GET    | `/`         | Bearer | List (`unread`) + unread count |
| PATCH  | `/read-all` | Bearer | Mark all read                  |
| PATCH  | `/:id/read` | Bearer | Mark one read                  |
| DELETE | `/:id`      | Bearer | Remove                         |

---

## Advertisements — `/advertisements`

| Method | Path                 | Auth           | Description                                          |
| ------ | -------------------- | -------------- | ---------------------------------------------------- |
| GET    | `/active`            | Bearer         | Public active ads feed                               |
| POST   | `/:id/track/:metric` | Bearer         | Increment `views` or `clicks`                        |
| GET    | `/`                  | Supplier/Admin | List own (supplier) or all (admin)                   |
| POST   | `/`                  | Supplier       | Create ad (status → `PENDING`)                       |
| GET    | `/:id`               | Owner/Admin    | Ad detail                                            |
| PATCH  | `/:id`               | Supplier       | Update (rejected ad → resubmit as `PENDING`)         |
| DELETE | `/:id`               | Owner/Admin    | Delete                                               |
| PATCH  | `/:id/review`        | Admin          | Approve/reject/expire `{ status, rejectionReason? }` |

Categories: `PRODUCT`,`SERVICE`,`PROMO`,`WEBINAR`. Statuses: `PENDING`,`ACTIVE`,`EXPIRED`,`REJECTED`.

---

## Reports & moderation — `/reports`

| Method | Path            | Auth   | Description                                             |
| ------ | --------------- | ------ | ------------------------------------------------------- |
| POST   | `/`             | Bearer | File a report                                           |
| GET    | `/`             | Admin  | List reports (`status`,`search`)                        |
| GET    | `/stats`        | Admin  | Report counters (total/pending/review/resolved)         |
| GET    | `/:id`          | Admin  | Report detail + moderation history                      |
| PATCH  | `/:id/status`   | Admin  | Set `PENDING`/`UNDER_REVIEW`/`RESOLVED`                 |
| POST   | `/:id/moderate` | Admin  | Apply `WARN`/`SUSPEND`/`BAN`/`REMOVE_CONTENT`/`DISMISS` |

Report reasons (14): `HARASSMENT`, `FRAUD_OR_SCAM`, `SPAM`, `MISINFORMATION`, `HATEFUL_SPEECH`, `THREATS_OR_VIOLENCE`, `SELF_HARM`, `EXTREMIST_ORGANIZATIONS`, `GRAPHIC_CONTENT`, `SEXUAL_CONTENT`, `FAKE_ACCOUNT`, `CHILD_EXPLOITATION`, `RESTRICTED_GOODS`, `NONCONSENSUAL_IMAGERY`.

---

## Subscriptions — `/subscriptions`

| Method | Path         | Auth   | Description                          |
| ------ | ------------ | ------ | ------------------------------------ | --------- |
| GET    | `/plans`     | Public | Plan catalogue + membership features |
| GET    | `/me`        | Bearer | Current subscription                 |
| POST   | `/subscribe` | Bearer | Subscribe `{ plan: MONTHLY           | YEARLY }` |
| POST   | `/cancel`    | Bearer | Cancel subscription                  |

---

## Admin — `/admin`

| Method | Path             | Auth  | Description                   |
| ------ | ---------------- | ----- | ----------------------------- |
| GET    | `/dashboard`     | Admin | Headline KPIs                 |
| GET    | `/statistics`    | Admin | 12-month time series (`year`) |
| GET    | `/settings`      | Admin | All app settings              |
| GET    | `/settings/:key` | Admin | One setting                   |
| PUT    | `/settings/:key` | Admin | Upsert a setting `{ value }`  |

---

## Uploads — `/uploads`

| Method | Path        | Auth   | Description                                |
| ------ | ----------- | ------ | ------------------------------------------ |
| POST   | `/`         | Bearer | Upload single file (form field `file`)     |
| POST   | `/multiple` | Bearer | Upload up to 12 files (form field `files`) |

Returns `{ url, filename, originalName, mimeType, size }`. Use the returned `url` as `imageUrl`/`images`/`documentUrl` when creating resources.

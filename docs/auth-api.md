# Birdora Auth API

Base URL:

```text
http://localhost:4000
```

Recommended local run:

```bash
npm install
npm start
```

Environment variables:

```text
PORT=4000
CORS_ORIGIN=http://localhost:4174
JWT_SECRET=change-this-in-production
JWT_EXPIRES_IN=7d
JWT_COOKIE_NAME=birdora_token
COOKIE_SECURE=false
```

Authentication:

- Login and register set an `HttpOnly` cookie named `birdora_token`.
- Web clients should rely on the cookie; the JWT is not returned in the JSON response.
- Protected routes accept either:
  - `Authorization: Bearer <token>`
  - or the auth cookie

Frontend calls should include credentials so the browser stores and sends the auth cookie:

```js
await fetch("http://localhost:4000/api/auth/login", {
  method: "POST",
  credentials: "include",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    email: "bird@example.com",
    password: "secret123",
  }),
});
```

## 1. Register

`POST /api/auth/register`

Request body:

```json
{
  "email": "bird@example.com",
  "password": "secret123",
  "nickname": "Bird Fan"
}
```

Success response `201`:

```json
{
  "message": "registered successfully",
  "user": {
    "id": "uuid",
    "email": "bird@example.com",
    "nickname": "Bird Fan",
    "createdAt": "2026-06-25T12:00:00.000Z",
    "updatedAt": "2026-06-25T12:00:00.000Z"
  }
}
```

## 2. Login

`POST /api/auth/login`

Request body:

```json
{
  "email": "bird@example.com",
  "password": "secret123"
}
```

Success response `200`:

```json
{
  "message": "login successful",
  "user": {
    "id": "uuid",
    "email": "bird@example.com",
    "nickname": "Bird Fan",
    "createdAt": "2026-06-25T12:00:00.000Z",
    "updatedAt": "2026-06-25T12:00:00.000Z"
  }
}
```

## 3. Logout

`POST /api/auth/logout`

Headers if using bearer token:

```text
Authorization: Bearer <token>
```

Success response `200`:

```json
{
  "message": "logout successful"
}
```

Notes:

- The server clears the auth cookie.
- If the current JWT is valid, its `jti` is added to a revocation list.

## 4. Get current user

`GET /api/auth/me`

Headers:

```text
Authorization: Bearer <token>
```

Success response `200`:

```json
{
  "authenticated": true,
  "user": {
    "id": "uuid",
    "email": "bird@example.com",
    "nickname": "Bird Fan",
    "createdAt": "2026-06-25T12:00:00.000Z",
    "updatedAt": "2026-06-25T12:00:00.000Z"
  }
}
```

Unauthorized response `401`:

```json
{
  "message": "Unauthorized"
}
```

## 5. Check login status

`GET /api/auth/status`

If logged in:

```json
{
  "authenticated": true,
  "user": {
    "id": "uuid",
    "email": "bird@example.com",
    "nickname": "Bird Fan",
    "createdAt": "2026-06-25T12:00:00.000Z",
    "updatedAt": "2026-06-25T12:00:00.000Z"
  }
}
```

If not logged in:

```json
{
  "authenticated": false,
  "user": null
}
```

## Health check

`GET /api/health`

Response:

```json
{
  "ok": true,
  "service": "birdora-auth-api",
  "timestamp": "2026-06-25T12:00:00.000Z"
}
```

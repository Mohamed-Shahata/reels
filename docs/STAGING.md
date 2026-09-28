# Staging Deployment

## Services

Deploy the frontend and API as separate services and use a managed PostgreSQL database. Build the API image from `backend/Dockerfile` with target `runtime`. Run a one-off release job from the same Dockerfile with target `migrate`, which executes `npm run db:deploy` before the API is deployed.

The frontend build command is `npm ci && npm run build` from `frontend`. Set `NEXT_PUBLIC_API_URL` at build time to the public API URL plus `/api/v1`.

## API environment

Set the required values from `backend/.env.example` in the API host. Use these staging-specific values:

```text
NODE_ENV=production
PORT=4000
DATABASE_URL=<managed-postgresql-url>
CORS_ORIGIN=https://<staging-frontend-host>
COOKIE_SAME_SITE=none
JWT_ACCESS_SECRET=<unique-32-plus-character-secret>
```

Set the existing Cloudinary credentials and upload settings there as protected secrets. `COOKIE_SAME_SITE=none` is needed when the staging frontend and API use different sites; production cookies stay `secure` automatically. Use `lax` when both hosts are under the same site, such as `app.example.com` and `api.example.com`.

## Verification

1. Run the migration release command and deploy the API image.
2. Confirm `GET https://<api-host>/api/v1/health` returns HTTP 200 and an `x-request-id` header.
3. Deploy the frontend with its API URL and register a new staging account.
4. Upload a video, create a clip, preview it and download it.
5. For any failed request, confirm the UI Reference ID is present in the API's structured logs.

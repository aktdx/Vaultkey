# VaultKey Deployment Guide

This guide covers deploying VaultKey to production environments.

## Prerequisites

Before deploying, ensure you have:

- A Neon PostgreSQL database (free tier available at [neon.tech](https://neon.tech))
- A Cloudflare R2 bucket (or S3-compatible storage)
- Backend hosting platform (Railway, Render, or Heroku)
- Frontend hosting platform (Vercel or Netlify)

---

## Backend Deployment

### Option 1: Railway (Recommended)

1. **Create a new project** on [Railway](https://railway.app)

2. **Connect your GitHub repository**

3. **Set environment variables** in Railway dashboard:
   ```
   JWT_SECRET=<generate with: python -c "import secrets; print(secrets.token_hex(64))">
   DATABASE_URL=<your Neon PostgreSQL connection string>
   R2_ACCOUNT_ID=<your Cloudflare account ID>
   R2_BUCKET_NAME=<your R2 bucket name>
   R2_ACCESS_KEY_ID=<your R2 access key>
   R2_SECRET_ACCESS_KEY=<your R2 secret key>
   ALLOWED_ORIGINS=https://your-frontend-domain.vercel.app
   ENVIRONMENT=production
   PORT=8000
   ```

4. **Set root directory** to `backend`

5. **Deploy**: Railway will automatically:
   - Install dependencies from `requirements.txt`
   - Run `alembic upgrade head` (via Procfile release command)
   - Start the server with `uvicorn`

6. **Note your deployment URL** (e.g., `https://vaultkey-backend.up.railway.app`)

### Option 2: Render

1. **Create a new Web Service** on [Render](https://render.com)

2. **Configure build settings**:
   - Build Command: `pip install -r requirements.txt && alembic upgrade head`
   - Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - Root Directory: `backend`

3. **Set environment variables** (same as Railway above)

4. **Deploy**

### Option 3: Heroku

1. **Install Heroku CLI** and login

2. **Create Heroku app**:
   ```bash
   heroku create vaultkey-api
   ```

3. **Set environment variables**:
   ```bash
   heroku config:set JWT_SECRET=<your-secret>
   heroku config:set DATABASE_URL=<your-neon-url>
   # ... set other vars
   ```

4. **Deploy**:
   ```bash
   git subtree push --prefix backend heroku main
   ```

5. The `Procfile` handles the release (migration) and web (server) processes

---

## Frontend Deployment

### Option 1: Vercel (Recommended)

1. **Import project** on [Vercel](https://vercel.com)

2. **Framework preset**: Vite

3. **Root directory**: `frontend`

4. **Build settings**:
   - Build Command: `npm run build`
   - Output Directory: `dist`

5. **Environment Variables**:
   ```
   VITE_API_URL=https://your-backend.railway.app
   ```
   (No trailing slash, no `/api` suffix)

6. **Deploy**: Vercel will build and deploy automatically

7. **Custom domain** (optional): Add your domain in Vercel project settings

### Option 2: Netlify

1. **Import project** on [Netlify](https://netlify.com)

2. **Build settings**:
   - Base directory: `frontend`
   - Build command: `npm run build`
   - Publish directory: `frontend/dist`

3. **Environment Variables**:
   ```
   VITE_API_URL=https://your-backend.railway.app
   ```

4. **Deploy**: Netlify will use the `netlify.toml` configuration

5. **Custom domain** (optional): Add in Netlify site settings

---

## Post-Deployment Checklist

### Backend

- [ ] Health check responds: `curl https://your-backend/api/health`
- [ ] Database migrations ran successfully (check logs)
- [ ] CORS origins include your frontend domain
- [ ] JWT_SECRET is set and secure (64+ hex characters)
- [ ] R2 bucket is accessible and has correct permissions

### Frontend

- [ ] Build completed without errors
- [ ] Environment variables are set correctly
- [ ] Can access the deployed URL
- [ ] Can register a new user
- [ ] Can upload and encrypt a file
- [ ] Can create a share link
- [ ] Share link works (test in incognito)
- [ ] API calls go to the correct backend

### Security

- [ ] HTTPS is enforced on both frontend and backend
- [ ] Security headers are present (check with browser DevTools)
- [ ] CORS is configured correctly (no wildcard in production)
- [ ] Rate limiting is active
- [ ] Database has backups enabled (Neon settings)

---

## Monitoring

### Health Endpoint

Monitor the `/api/health` endpoint:
```bash
curl https://your-backend/api/health
```

Expected response when healthy:
```json
{
  "app": "VaultKey",
  "version": "1.0.0",
  "db": "ok",
  "status": "ok"
}
```

Returns HTTP 503 when degraded.

### Logging

- **Railway**: View logs in the Railway dashboard
- **Render**: View logs in the Render dashboard
- **Vercel/Netlify**: View build and function logs in their dashboards

---

## Troubleshooting

### Backend won't start

**Issue**: `RuntimeError: JWT_SECRET environment variable is not set`  
**Fix**: Add JWT_SECRET to environment variables

**Issue**: Database connection fails  
**Fix**: Verify DATABASE_URL is correct and Neon database is running

**Issue**: Alembic migration fails  
**Fix**: Check migration logs. May need to manually run `alembic upgrade head`

### Frontend build fails

**Issue**: `VITE_API_URL is not defined`  
**Fix**: Set VITE_API_URL in deployment platform environment variables

**Issue**: Build succeeds but API calls fail  
**Fix**: Verify v points to your backend (check browser Network tab)

### CORS errors

**Issue**: `Access to fetch at 'https://backend' from origin 'https://frontend' has been blocked by CORS`  
**Fix**: Add frontend domain to ALLOWED_ORIGINS in backend environment variables

---

## Updating Production

### Backend updates

1. Push changes to your repository
2. Railway/Render will auto-deploy
3. Migrations run automatically via Procfile release command

### Frontend updates

1. Push changes to your repository
2. Vercel/Netlify will auto-deploy
3. New build will be live in ~1-2 minutes

### Database schema changes

1. Create a new Alembic migration locally:
   ```bash
   cd backend
   alembic revision --autogenerate -m "description"
   ```
2. Review the generated migration in `alembic/versions/`
3. Test locally: `alembic upgrade head`
4. Commit and push - production will run migration on deploy

---

## Scaling Considerations

- **Database**: Neon scales automatically. Consider upgrading plan for high traffic
- **Storage**: R2 is designed for large-scale object storage
- **Backend**: Add more dynos/instances in Railway/Render for high concurrency
- **Frontend**: Vercel/Netlify CDN handles scaling automatically
- **Rate Limiting**: Adjust limits in `backend/app/limiter.py` if needed

---

## Cost Estimates (Monthly)

- **Neon PostgreSQL**: Free tier (0.5 GB storage) or $19/month (paid)
- **Cloudflare R2**: $0.015/GB storage, first 10GB free
- **Railway**: Free tier (500 hours) or $5/month per service
- **Vercel**: Free tier (100 GB bandwidth) or $20/month (Pro)
- **Total**: Can run entirely free on free tiers for development/testing

---

For local development setup, see the main [README](../README.md).

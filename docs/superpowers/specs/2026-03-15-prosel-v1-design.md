# Prosel V1 Design

Date: 2026-03-15

## 1. Product Goal

Prosel V1 is a minimal personal blogging system.

The target is not a broad content platform. The target is a real, shippable loop with:

- a public homepage
- a public article list
- a public article detail page
- a private admin area for article CRUD
- a minimal publication workflow

The system should be simple enough to bootstrap quickly, but structured enough to become the first real product driven by Scorel.

## 2. Scope

### In Scope

- One `Next.js` application for both public pages and admin UI
- One `Go` API for business logic and data access
- One `PostgreSQL` database as the single content source of truth
- One admin user only
- Article states:
  - `draft`
  - `published`
- Public pages:
  - homepage
  - article list
  - article detail
- Admin features:
  - login
  - article create
  - article edit
  - article publish / unpublish

### Out of Scope for V1

- tags
- categories
- search
- RSS
- comments
- multi-user support
- registration flow
- password reset
- rich collaborative editing
- analytics

## 3. Architecture

### 3.1 Frontend

`Next.js` serves both:

- public site pages
- admin pages

Public pages read through the `Go` API.

Admin pages also write through the `Go` API.

This keeps the UI delivery surface small while preserving a clear backend boundary.

### 3.2 Backend

`Go` provides:

- article read API for public pages
- article write API for admin
- admin auth/session backend support
- content status transitions

The API owns business rules. `Next.js` should not become the hidden source of truth.

### 3.3 Database

`PostgreSQL` is the only content source of truth.

This avoids the awkwardness of “admin editing Git files” and matches the long-term deployment direction better than SQLite.

## 4. Core Data Model

### 4.1 Article

Initial `Article` fields:

- `id`
- `title`
- `slug`
- `summary`
- `content_md`
- `status`
- `published_at`
- `created_at`
- `updated_at`

### 4.2 Status Rules

- `draft` means not publicly visible
- `published` means visible on homepage, article list, and article detail pages
- `published_at` is set when an article is published
- unpublishing returns the article to `draft`

## 5. Admin Model

V1 uses a single admin user.

Expected environment variables:

- `PROSEL_ADMIN_USERNAME`
- `PROSEL_ADMIN_PASSWORD`

Recommended session model:

- server-side session
- simple login gate for admin routes

This is intentionally minimal. The goal is to enable publishing, not build a general identity system.

## 6. Content Flow

### 6.1 Public Read Flow

`Next.js public pages -> Go API -> PostgreSQL`

### 6.2 Admin Write Flow

`Next.js admin pages -> Go API -> PostgreSQL`

### 6.3 Editorial Flow

The first version supports only:

- save draft
- publish
- unpublish

No workflow beyond that should be introduced in V1.

## 7. Monorepo Shape

The repository is expected to be a monorepo.

A practical starting shape is:

```text
apps/
  web/        # Next.js app
services/
  api/        # Go API
infra/
  db/         # migrations / local db helpers
```

The exact folder names can change, but the separation between web, api, and database infrastructure should remain clear.

## 8. Deployment Assumption

Development should optimize for a local monorepo workflow first.

Deployment is expected to split by responsibility:

- `Next.js` on `Vercel`
- `Go API` on `VPS`
- `PostgreSQL` attached to the backend environment

This deployment assumption should influence config and API boundary design, but not dominate early implementation complexity.

## 9. Initial Delivery Plan

The first delivery wave should be represented by these work items:

1. define the V1 architecture and spec
2. initialize the monorepo skeleton
3. set up PostgreSQL and article schema
4. implement Go article CRUD API
5. implement single-admin authentication
6. build admin article CRUD pages in Next.js
7. build public homepage, article list, and article detail pages
8. wire the publish flow end to end
9. deploy the baseline to Vercel and VPS
10. publish the first real article through the production flow

## 10. Success Criteria

Prosel V1 is successful when all are true:

- one admin can log in
- one draft article can be created and edited
- one article can be published
- the published article appears on the public site
- the system can be deployed with frontend and backend separated
- Scorel can use this backlog to drive real delivery work

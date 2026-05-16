# BLACKNEL — SUPER PROMPT MAESTRO PARA CLAUDE CODE

> Documento único, completo y detallado para construir **Blacknel** desde cero hasta producto vendible. Pensado para ser ejecutado fase por fase por Claude Code con cero ambigüedad.

---

## ÍNDICE

1. Identidad del proyecto
2. Stack técnico definitivo
3. Reglas no negociables
4. Convenciones de código y calidad
5. Estructura de carpetas del monorepo
6. Modelo de datos conceptual completo
7. Arquitectura de conectores (capability flags)
8. Sistema de mocks
9. Planes, feature gating y permisos
10. Sistema de IA y guardrails
11. Diseño y UX guidelines
12. **Las 12 fases — detalle quirúrgico**
13. Checklist global de calidad
14. Cómo empezar y terminar cada fase
15. Reglas de comunicación entre Claude Code y el humano

---

# 1. IDENTIDAD DEL PROYECTO

## 1.1 Nombre

El producto se llama **Blacknel**.

No se llama Looms. No se llama otra cosa. Si encuentras "Looms" en cualquier referencia, es error histórico — corrígelo siempre a **Blacknel**.

## 1.2 Qué es

Blacknel es una plataforma web SaaS todo-en-uno para que cualquier empresa maneje en un solo lugar:

- Redes sociales (publicación, calendario, comentarios, DMs)
- Inbox unificado (Messenger, IG, WhatsApp, comentarios, menciones, reseñas)
- Reseñas y reputación (Google, Yelp, TripAdvisor, Trustpilot, BBB, etc.)
- IA para responder, generar contenido y detectar crisis
- Reportes y dashboards ejecutivos
- Social listening y monitoreo de competidores
- Ads intelligence (Meta, Google, TikTok, LinkedIn, X)
- NPS / CSAT / CES
- Multi-marca, multi-ubicación, multi-usuario

## 1.3 Para quién

Para cualquier empresa con presencia digital: restaurantes, clínicas, hoteles, salones, gimnasios, escuelas, agencias, franquicias, concesionarias, hospitales, despachos profesionales, grupos médicos, universidades, cadenas, empresas multi-sucursal, marcas regionales y nacionales.

**No** es exclusivo de law firms. Cualquier vertical es bienvenida. Las reglas sensibles se configuran por industria, no se hardcodean.

## 1.4 Posicionamiento

Compite contra: Hootsuite, Sprout Social, Respondelligent, Birdeye, Sprinklr, Khoros, Brand24, Mention, Reputation.com.

Diferenciación: más simple, más barato, más amplio en alcance (reviews + social + listening + ads + IA en un solo producto), pricing claro, sin add-ons confusos.

## 1.5 Promesa comercial

> **"Blacknel centraliza redes sociales, reseñas, mensajes, publicaciones, IA, reputación y reportes en una sola plataforma desde $69/mes."**

## 1.6 Planes oficiales (cerrado, no cambiar)

| Plan | Precio | Marcas | Usuarios | Cuentas sociales | Ubicaciones | Posts/mes |
|------|--------|--------|----------|------------------|-------------|-----------|
| **Standard** | $69/mes | 1 | 3 | 5 | 1 | 30 |
| **Growth** | $299/mes | 3 | 10 | 20 | 5 | 250 |
| **Enterprise** | $1,099/mes | ilimitadas | ilimitados | 75 | 25 | ilimitado |

Sin descuentos temporales. Sin "primeros 3 meses gratis". Precios fijos visibles desde el inicio.

## 1.7 Plataforma

**Solo web por ahora.** No mobile. No app nativa. No PWA forzada. Sí responsive desktop-first (la app es para uso de escritorio principalmente, pero no debe romperse en tablet).

---

# 2. STACK TÉCNICO DEFINITIVO

Este stack es **el stack** del proyecto. No cambies de tecnología sin pedir confirmación al humano.

## 2.1 Frontend / Framework

- **Next.js 16** con App Router
- **React 19**
- **TypeScript estricto** (`strict: true`, `noUncheckedIndexedAccess: true`)
- **Tailwind CSS v4**
- **shadcn/ui** (componentes copiados a `components/ui/`)
- **Lucide React** para iconos
- **next-themes** para light/dark mode
- **Framer Motion** solo para microinteracciones puntuales (no abusar)

## 2.2 Backend / Datos

- **Supabase** (Postgres 15+, Auth, Storage, RLS, Realtime)
- **Drizzle ORM** sobre Postgres (no usar el cliente de Supabase para queries — solo para Auth y Storage)
- **Upstash Redis** para rate limiting, caché y job locks
- **Inngest** para jobs en background, crons, workflows, retries
- **Zod** para toda validación de input/output

## 2.3 IA

- **Claude Agent SDK** (`@anthropic-ai/sdk`)
- Modelo principal: `claude-opus-4-7` para razonamiento complejo (compliance check, crisis detection, report explanation)
- Modelo barato: `claude-haiku-4-5` para clasificación de sentimiento, intención, plantillas
- **Prompt caching** obligatorio para system prompts largos
- Todas las llamadas pasan por un wrapper único en `lib/ai/client.ts` que registra costos en `ai_generation_log`

## 2.4 Observabilidad y operación

- **PostHog** para analytics de producto (eventos, funnels, dashboards)
- **Sentry** para errores en producción
- **Resend** para emails transaccionales
- **Vercel** para hosting (Edge + Serverless functions)

## 2.5 Pagos

- **Stripe** (suscripciones + customer portal)
- Se cablea hasta **Fase 12**. Antes solo conceptual.

## 2.6 Lo que NO se usa

- Prisma (usamos Drizzle)
- tRPC (usamos Server Actions + Route Handlers tipados)
- Redux / Zustand para estado global de servidor (usamos React Query / TanStack Query y Server Components)
- Material UI / Chakra / Ant Design (solo shadcn/ui)
- Moment.js (usamos `date-fns` y `Temporal` cuando aplique)
- Axios (usamos `fetch` nativo)
- Firebase, MongoDB, MySQL — el único backend es Supabase/Postgres

## 2.7 Versiones mínimas

- Node 22 LTS
- pnpm 9+ (gestor de paquetes obligatorio)
- TypeScript 5.6+
- Postgres 15+

---

# 3. REGLAS NO NEGOCIABLES

Estas reglas son inviolables. Si una pareciera contradecirse con una petición, **pregunta al humano antes de violarla**.

## 3.1 Producto

1. **El producto se llama Blacknel.** Nunca Looms. Nunca otra cosa.
2. **Solo web.** Nada de mobile nativo en este proyecto.
3. **3 planes fijos:** Standard $69, Growth $299, Enterprise $1,099. No más, no menos.
4. **APIs externas reales se conectan hasta Fase 11.** Hasta entonces, todo es mock.
5. **No publicar nada sensible automáticamente.** Crisis, reseñas negativas, temas legales/médicos/financieros, casos con datos personales — todo eso pasa por approval flow humano.

## 3.2 Arquitectura

6. **Multi-tenant desde la primera línea de código.** Toda tabla con datos de cliente tiene `organization_id`. RLS en todas las tablas de negocio.
7. **Conectores por capacidades.** No hardcodear lógica de Meta/Google/TikTok en pantallas. La UI consume entidades normalizadas (`InboxThread`, `Review`, `ConnectedAccount`) con `PlatformCapability` declarado.
8. **Feature gating por plan en el servidor**, no solo UI. Cliente puede ocultar botones, pero el servidor debe rechazar acciones fuera del plan.
9. **No hay "god routes".** Cada Server Action y Route Handler hace una sola cosa y valida input con Zod.
10. **Idempotencia obligatoria** en jobs, webhooks y envío de mensajes/posts. Nunca duplicar acciones por reintento.

## 3.3 Calidad

11. **TypeScript estricto.** Cero `any` excepto en boundaries con APIs externas, y siempre con un `// FIXME: typed wrapper pendiente` al lado.
12. **Cero secretos en código.** Todos los secretos vienen de `process.env` con un wrapper validado por Zod en `lib/env.ts`.
13. **Cero errores silenciosos.** Todo error se loguea con contexto (`organization_id`, `user_id`, `request_id`) y se propaga a Sentry.
14. **Tests obligatorios** para: feature gating, permisos, capability flags, compliance check de IA, parseo de webhooks, cálculo de límites de plan.
15. **No mergear código que no compile, no pase lint, no pase typecheck.** El `pnpm verify` debe pasar siempre.

## 3.4 IA

16. **Todo prompt de IA está en `lib/ai/prompts/` como módulo TypeScript.** Nunca prompts inline en componentes.
17. **Toda generación de IA queda registrada** en `ai_generation_log` con costo, modelo, latencia, tokens, hash de input, hash de output.
18. **Toda respuesta de IA que vaya a publicarse pasa por `complianceCheck()`**, no por confianza ciega.
19. **La IA nunca publica directamente.** Genera borradores. El humano (o una regla explícita aprobada) publica.

## 3.5 UX

20. **Cero estados vacíos sin propósito.** Cada pantalla vacía explica qué pasará cuando haya datos y ofrece una acción.
21. **Cero loading spinners sin contexto.** Usar skeletons que reflejen la estructura de los datos esperados.
22. **Cero errores sin acción de recuperación.** Cada error muestra qué pasó, por qué y qué puede hacer el usuario.
23. **Cero textos comerciales agresivos.** Los upgrade prompts son informativos, no manipulativos.

---

# 4. CONVENCIONES DE CÓDIGO Y CALIDAD

## 4.1 Naming

- Archivos: `kebab-case.ts`
- Componentes React: `PascalCase.tsx`
- Funciones, variables: `camelCase`
- Tipos, interfaces, enums: `PascalCase`
- Constantes: `SCREAMING_SNAKE_CASE`
- Tablas de DB: `snake_case` plural (`inbox_threads`, `connected_accounts`)
- Columnas de DB: `snake_case` singular (`organization_id`, `created_at`)
- Enums de DB: `snake_case` (`inbox_thread_status`)

## 4.2 Estructura de un componente

```tsx
// 1. Imports (React, externos, internos, tipos)
// 2. Types/interfaces locales
// 3. Constantes locales
// 4. Componente principal
// 5. Subcomponentes locales si aplica
// 6. Funciones helper si son simples y locales
```

## 4.3 Server Actions

Todas las Server Actions:

- Viven en `app/(...)/actions.ts` o en `lib/actions/<dominio>.ts`
- Validan input con Zod
- Verifican autenticación y autorización antes de actuar
- Verifican feature gating del plan
- Devuelven un `Result<T>` discriminado: `{ ok: true, data } | { ok: false, error: { code, message, fields? } }`
- Nunca lanzan excepciones al cliente — siempre devuelven `Result`

```ts
// lib/types/result.ts
export type Result<T, E = AppError> =
  | { ok: true; data: T }
  | { ok: false; error: E };
```

## 4.4 Comentarios

- Comentarios solo donde el código no es obvio
- Comentarios en **inglés** (el código habla un solo idioma)
- TODOs deben tener formato `// TODO(blacknel): descripción [#issue]`
- FIXMEs deben tener formato `// FIXME(blacknel): descripción [#issue]`

## 4.5 Logs

```ts
import { log } from '@/lib/log';

log.info({ organizationId, userId }, 'Inbox thread assigned');
log.error({ error, organizationId, threadId }, 'Failed to send reply');
```

Logs siempre estructurados (pino-style). Nunca `console.log` en producción.

## 4.6 Errores tipados

```ts
// lib/errors.ts
export class AppError extends Error {
  constructor(
    public code: AppErrorCode,
    message: string,
    public meta?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export type AppErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'PLAN_LIMIT_REACHED'
  | 'FEATURE_NOT_AVAILABLE_ON_PLAN'
  | 'CAPABILITY_NOT_AVAILABLE'
  | 'INTEGRATION_DISCONNECTED'
  | 'AI_GENERATION_BLOCKED'
  | 'AI_COMPLIANCE_VIOLATION'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';
```

## 4.7 Scripts de package.json

```json
{
  "dev": "next dev --turbopack",
  "build": "next build",
  "start": "next start",
  "lint": "eslint . --max-warnings=0",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
  "db:studio": "drizzle-kit studio",
  "db:seed": "tsx scripts/seed.ts",
  "verify": "pnpm lint && pnpm typecheck && pnpm test"
}
```

Antes de terminar cualquier fase, `pnpm verify` debe pasar limpio.

---

# 5. ESTRUCTURA DE CARPETAS DEL MONOREPO

Por ahora **una sola app** (no monorepo), pero estructura preparada para extraer paquetes después.

```
blacknel/
├── app/
│   ├── (marketing)/                  # Landing pública, pricing, login
│   │   ├── page.tsx
│   │   ├── pricing/page.tsx
│   │   └── login/page.tsx
│   ├── (app)/                        # App autenticada
│   │   ├── layout.tsx                # Layout con sidebar + topbar
│   │   ├── dashboard/page.tsx
│   │   ├── inbox/
│   │   ├── publish/
│   │   ├── reviews/
│   │   ├── reputation/
│   │   ├── listening/
│   │   ├── competitors/
│   │   ├── ads/
│   │   ├── reports/
│   │   ├── ai-studio/
│   │   ├── feedback/
│   │   ├── automations/
│   │   ├── approvals/
│   │   ├── integrations/
│   │   ├── locations/
│   │   ├── team/
│   │   ├── billing/
│   │   ├── settings/
│   │   └── audit/
│   ├── (onboarding)/                 # Flujo de onboarding aislado
│   │   └── onboarding/...
│   ├── api/                          # Route handlers (webhooks, callbacks)
│   │   ├── webhooks/
│   │   └── inngest/route.ts
│   └── layout.tsx
├── components/
│   ├── ui/                           # shadcn/ui copiados
│   ├── layout/                       # Sidebar, Topbar, Shell, Breadcrumbs
│   ├── inbox/
│   ├── publish/
│   ├── reviews/
│   ├── ai/
│   └── ...
├── lib/
│   ├── db/
│   │   ├── schema/                   # Una entidad por archivo
│   │   ├── client.ts                 # Drizzle client
│   │   ├── migrations/
│   │   └── queries/                  # Queries reusables tipadas
│   ├── auth/
│   ├── plans/                        # plans.ts, gating.ts, limits.ts
│   ├── permissions/                  # roles.ts, can.ts, policies/
│   ├── connectors/                   # Conectores por plataforma
│   │   ├── base/                     # Interfaces + capability flags
│   │   ├── facebook/
│   │   ├── instagram/
│   │   ├── google-business-profile/
│   │   ├── whatsapp/
│   │   ├── tiktok/
│   │   ├── linkedin/
│   │   ├── x/
│   │   ├── yelp/
│   │   ├── tripadvisor/
│   │   ├── trustpilot/
│   │   ├── bbb/
│   │   ├── avvo/
│   │   ├── youtube/
│   │   ├── pinterest/
│   │   ├── reddit/
│   │   └── mock/                     # Conector mock universal
│   ├── ai/
│   │   ├── client.ts                 # Wrapper Claude SDK
│   │   ├── prompts/
│   │   ├── compliance.ts
│   │   ├── sentiment.ts
│   │   ├── intent.ts
│   │   ├── crisis.ts
│   │   └── translate.ts
│   ├── jobs/                         # Inngest functions
│   ├── webhooks/                     # Parsers de webhooks externos
│   ├── reports/
│   ├── automations/
│   ├── audit/
│   ├── billing/                      # Stripe wrapper (Fase 12)
│   ├── mocks/                        # Generadores de mocks
│   ├── log.ts
│   ├── env.ts
│   ├── errors.ts
│   └── types/
├── styles/
│   └── globals.css
├── scripts/
│   ├── seed.ts
│   └── reset-mocks.ts
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── public/
├── drizzle.config.ts
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── README.md
```

---

# 6. MODELO DE DATOS CONCEPTUAL COMPLETO

Todas las tablas tienen como mínimo:

- `id uuid primary key default gen_random_uuid()`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `organization_id uuid` (excepto `organizations` y `users` base)

Todas las tablas con `organization_id` tienen **RLS habilitado** que filtra por el `organization_id` de la sesión.

## 6.1 Identidad y tenancy

- `organizations` — id, name, slug, plan_id, created_by, billing_email, country, locale, timezone, status
- `organization_members` — organization_id, user_id, role, status, invited_by, invited_at, joined_at
- `users` — id (Supabase auth.users), email, name, avatar_url, default_organization_id, locale
- `invitations` — organization_id, email, role, token, expires_at, accepted_at, accepted_by

## 6.2 Marcas y ubicaciones

- `brands` — organization_id, name, slug, logo_url, brand_voice_id, status
- `locations` — organization_id, brand_id, name, address, city, state, country, timezone, phone, gbp_place_id, status
- `brand_voices` — organization_id, name, tone, style, allowed_emojis, forbidden_words, preferred_words, languages, ctas, disclaimers

## 6.3 Planes y billing

- `plans` — id, code (`standard`/`growth`/`enterprise`), name, price_cents, limits jsonb, features jsonb, stripe_price_id
- `subscriptions` — organization_id, plan_id, status, stripe_subscription_id, current_period_end, cancel_at
- `usage_counters` — organization_id, metric (`posts_scheduled_this_month`, etc.), period_start, period_end, value

## 6.4 Conectores

- `connected_accounts` — organization_id, brand_id, location_id (nullable), platform (`facebook`, `instagram`, `gbp`, `whatsapp`, ...), external_account_id, display_name, handle, status (`connected`, `disconnected`, `expired`, `error`), last_sync_at, error_message, capabilities jsonb, oauth_tokens_encrypted, metadata jsonb
- `connector_sync_runs` — connected_account_id, started_at, finished_at, status, items_synced, error

## 6.5 Inbox

- `contact_profiles` — organization_id, platform, external_id, display_name, avatar_url, handle, language, tags, metadata jsonb
- `inbox_threads` — organization_id, brand_id, location_id, connected_account_id, platform, external_thread_id, contact_profile_id, kind (`dm`, `comment`, `mention`, `review`, `whatsapp`), status, priority, sentiment, assigned_to, last_message_at, sla_breach_at, closed_at, tags
- `inbox_messages` — thread_id, direction (`inbound`, `outbound`), author_type (`contact`, `user`, `ai`, `system`), author_id, body, media jsonb, sent_at, external_message_id, idempotency_key
- `internal_notes` — thread_id, author_id, body, pinned, mentions jsonb
- `saved_replies` — organization_id, brand_id, name, category, language, body, variables, platforms_allowed, requires_approval

## 6.6 Publishing

- `posts` — organization_id, brand_id, campaign_id, author_id, status (`draft`, `pending_approval`, `scheduled`, `publishing`, `published`, `failed`, `cancelled`), text, media_ids, link, utm, scheduled_at, published_at, idempotency_key
- `post_targets` — post_id, connected_account_id, platform_variant (text override por red), status, external_post_id, published_at, error
- `campaigns` — organization_id, brand_id, name, goal, starts_at, ends_at, status, owner_id, budget_cents
- `content_assets` — organization_id, brand_id, kind (`image`, `video`, `pdf`), url, thumbnail_url, name, tags, expires_at, approved, uploaded_by, used_count

## 6.7 Reviews y reputación

- `reviews` — organization_id, location_id, connected_account_id, platform, external_review_id, author_name, author_avatar, rating, body, language, posted_at, sentiment, status, assigned_to, escalated
- `review_responses` — review_id, draft_text, final_text, status (`draft`, `pending_approval`, `approved`, `published`, `rejected`), author_id, ai_generated, compliance_score, published_at, external_response_id
- `review_requests` — organization_id, location_id, channel (`email`, `sms`, `whatsapp`, `qr`), contact_info, sent_at, opened_at, completed_at, outcome (`positive_routed`, `negative_captured`, `no_response`)
- `reputation_snapshots` — organization_id, location_id, platform, date, rating_avg, review_count, response_rate, sentiment_breakdown jsonb

## 6.8 Feedback (NPS/CSAT/CES)

- `feedback_campaigns` — organization_id, kind (`nps`, `csat`, `ces`), name, status, channels, schedule
- `feedback_responses` — campaign_id, contact_profile_id, score, comment, sentiment, posted_at
- `feedback_followups` — response_id, action_taken, assigned_to, status

## 6.9 Listening y competidores

- `listening_topics` — organization_id, brand_id, name, query, boolean_query, sources, languages, status
- `mentions` — organization_id, topic_id, source, external_id, author, url, body, language, sentiment, reach, posted_at
- `competitors` — organization_id, brand_id, name, urls jsonb (mapa de red→url), notes, status
- `competitor_snapshots` — competitor_id, platform, date, followers, posts_count, engagement_rate, rating_avg, review_count, share_of_voice

## 6.10 Ads

- `ad_accounts` — organization_id, brand_id, platform, external_account_id, currency, status
- `ad_campaigns` — ad_account_id, external_id, name, objective, status, started_at, ended_at
- `ad_metrics` — ad_campaign_id, date, spend_cents, impressions, reach, clicks, ctr, cpc, cpm, conversions, leads, cpl

## 6.11 Reports

- `report_templates` — organization_id, name, sections jsonb, filters jsonb, schedule, recipients
- `report_runs` — template_id, generated_at, range_start, range_end, status, pdf_url, payload jsonb

## 6.12 Automations

- `automations` — organization_id, brand_id, name, trigger jsonb, conditions jsonb, actions jsonb, status, created_by
- `automation_runs` — automation_id, fired_at, status, input jsonb, output jsonb, error

## 6.13 Approvals

- `approvals` — organization_id, kind (`post`, `review_response`, `inbox_reply`, `crisis_response`, `campaign`), entity_id, requested_by, assigned_to, status (`pending`, `approved`, `edited_approved`, `rejected`, `expired`, `escalated`), original_payload jsonb, proposed_payload jsonb, decision_reason, decided_at, risk_level, ai_risk_flags

## 6.14 Crisis

- `crisis_alerts` — organization_id, brand_id, location_id, severity (`low`, `medium`, `high`, `critical`), summary, sources jsonb, related_entities jsonb, status, owner_id, opened_at, resolved_at

## 6.15 Auditoría

- `audit_events` — organization_id, user_id, actor_type (`user`, `ai`, `system`, `automation`), action, entity_type, entity_id, before jsonb, after jsonb, ip, user_agent, risk_level, created_at

## 6.16 IA

- `ai_generations` — organization_id, user_id, kind (`reply`, `caption`, `summary`, `translation`, ...), model, input_hash, output_hash, tokens_input, tokens_output, cost_usd, latency_ms, status, related_entity_type, related_entity_id, compliance_flags jsonb
- `ai_recommendations` — organization_id, kind, entity_type, entity_id, body, reasoning, status (`pending`, `accepted`, `dismissed`), created_at

## 6.17 RLS

Para cada tabla con `organization_id`, política base:

```sql
create policy "tenant_isolation" on <table>
  using (organization_id = (select organization_id from organization_members
                           where user_id = auth.uid() and status = 'active'
                           limit 1));
```

Políticas adicionales por rol se aplican como capas en `lib/permissions/`.

---

# 7. ARQUITECTURA DE CONECTORES (CAPABILITY FLAGS)

## 7.1 Principio

La UI **nunca** sabe si una cuenta es de Facebook, Instagram o Yelp. Solo sabe qué capacidades tiene. Si la API de una plataforma cambia, **solo cambia el conector** — la UI no se toca.

## 7.2 Interface base

```ts
// lib/connectors/base/types.ts
export type PlatformCode =
  | 'facebook' | 'instagram' | 'gbp' | 'whatsapp' | 'tiktok'
  | 'linkedin' | 'x' | 'youtube' | 'pinterest' | 'reddit'
  | 'yelp' | 'tripadvisor' | 'trustpilot' | 'bbb' | 'avvo'
  | 'mock';

export type Capability =
  | 'read_comments' | 'reply_comments'
  | 'read_dms' | 'send_dms'
  | 'read_mentions'
  | 'publish_post' | 'schedule_post' | 'delete_post'
  | 'read_insights'
  | 'read_reviews' | 'reply_reviews'
  | 'read_ads' | 'pause_ads'
  | 'send_review_request';

export interface ConnectorCapabilities {
  supported: Capability[];
  notes?: Partial<Record<Capability, string>>;
}

export interface Connector {
  platform: PlatformCode;
  capabilities(account: ConnectedAccount): ConnectorCapabilities;

  // Métodos opcionales — cada uno corresponde a una capability
  fetchComments?(account, opts): Promise<NormalizedComment[]>;
  replyComment?(account, commentId, body): Promise<{ externalId: string }>;
  fetchDMs?(account, opts): Promise<NormalizedThread[]>;
  sendDM?(account, threadId, body): Promise<{ externalId: string }>;
  publishPost?(account, draft): Promise<{ externalId: string }>;
  schedulePost?(account, draft, when): Promise<{ externalId: string }>;
  fetchReviews?(account, opts): Promise<NormalizedReview[]>;
  replyReview?(account, reviewId, body): Promise<{ externalId: string }>;
  fetchInsights?(account, range): Promise<NormalizedInsights>;
}
```

## 7.3 Registro central

```ts
// lib/connectors/registry.ts
export const connectorRegistry: Record<PlatformCode, Connector> = {
  facebook: facebookConnector,
  instagram: instagramConnector,
  // ...
  mock: mockConnector,
};

export function getConnector(platform: PlatformCode): Connector {
  return connectorRegistry[platform];
}
```

## 7.4 UI consume capacidades

```tsx
const { capabilities } = useConnectedAccount(accountId);
const canReply = capabilities.supported.includes('reply_reviews');

return (
  <Button disabled={!canReply} tooltip={!canReply ? 'Esta plataforma no permite responder reseñas desde Blacknel con los permisos actuales.' : undefined}>
    Responder
  </Button>
);
```

## 7.5 Fallbacks claros

Si una capability no está soportada, la UI muestra un estado informativo. **Nunca esconder funcionalidad sin explicar**.

---

# 8. SISTEMA DE MOCKS

Los mocks son **producto, no andamiaje**. Hasta Fase 11 son la única fuente de datos de integraciones externas. Deben sentirse reales.

## 8.1 Principios

1. Los mocks viven en `lib/connectors/mock/` y en `lib/mocks/`.
2. Cada conector tiene un modo `mock` activado por env var `BLACKNEL_USE_MOCKS=true` (default en dev/staging).
3. Los mocks generan datos realistas con `@faker-js/faker` + datasets curados por industria.
4. Los mocks simulan errores: tokens expirados, rate limits, capabilities faltantes, posts fallidos, reseñas negativas en serie.
5. Los mocks tienen comportamiento temporal: nuevas reseñas llegan cada X minutos, mensajes nuevos aparecen, sentimiento varía.

## 8.2 Seed mock

`scripts/seed.ts` debe generar un dataset completo y útil:

- 1 organization "Blacknel Demo"
- 2 brands: "La Trattoria" (restaurante) y "Clínica Solis" (salud)
- 5 locations distribuidas entre las 2 brands
- 6 users con distintos roles
- 8 connected accounts (mock) cubriendo: FB, IG, GBP, WhatsApp, TikTok, LinkedIn, Yelp, TripAdvisor
- 150 inbox threads en distintos estados, prioridades, sentimientos
- 80 reviews distribuidas por ubicación y plataforma, 15% negativas
- 40 posts en estados variados (draft, scheduled, published, failed)
- 3 campaigns activas
- 5 listening topics con menciones
- 3 competitors con snapshots
- 2 ad accounts con métricas
- 12 approvals pendientes
- 2 crisis alerts (1 abierta, 1 resuelta)
- 6 automations activas
- Datos de NPS con 50 respuestas

## 8.3 Comportamiento temporal en mocks

Un Inngest cron en mock-mode genera nuevos eventos cada hora:

- 3-5 mensajes nuevos en inbox
- 1-2 reseñas nuevas
- 1 mención de listening
- Métricas de ads se actualizan

Esto hace que el producto se sienta vivo en demos.

## 8.4 Errores simulados

`BLACKNEL_MOCK_ERRORS=true` activa errores aleatorios:

- 5% chance de "token expired" al hacer una acción
- 2% chance de "rate limit" en sync
- 10% chance de que un post falle al publicar
- 1 cuenta siempre en estado `disconnected`

Esto permite probar todos los estados de error en UI durante desarrollo.

---

# 9. PLANES, FEATURE GATING Y PERMISOS

## 9.1 Plans como código

```ts
// lib/plans/plans.ts
export const PLANS = {
  standard: {
    code: 'standard',
    name: 'Standard',
    priceCents: 6900,
    limits: {
      brands: 1, users: 3, socialAccounts: 5, locations: 1, postsPerMonth: 30,
    },
    features: {
      networks: ['facebook', 'instagram', 'gbp'],
      ai: 'basic',
      listening: false,
      competitors: false,
      ads: false,
      reports: 'basic',
      approvals: false,
      audit: false,
      nps: false,
      crisis: false,
      reportBuilder: false,
    },
  },
  growth: { /* ... */ },
  enterprise: { /* ... */ },
} as const satisfies Record<string, PlanDefinition>;
```

## 9.2 Gating helpers

```ts
// lib/plans/gating.ts
export function planAllowsFeature(plan: PlanCode, feature: FeatureKey): boolean;
export function planAllowsPlatform(plan: PlanCode, platform: PlatformCode): boolean;
export async function checkLimit(orgId: string, metric: LimitMetric): Promise<{ ok: boolean; current: number; limit: number }>;

export async function requireFeature(orgId: string, feature: FeatureKey): Promise<void> {
  // Throws AppError('FEATURE_NOT_AVAILABLE_ON_PLAN') if not allowed
}
```

Todo Server Action que toque feature gated llama `requireFeature(orgId, ...)` antes de ejecutar.

## 9.3 UI gates

```tsx
<FeatureGate feature="listening" fallback={<UpgradePrompt to="growth" feature="Social Listening" />}>
  <ListeningDashboard />
</FeatureGate>
```

## 9.4 Roles y permisos

Roles iniciales: `owner`, `admin`, `manager`, `agent`, `viewer`.

```ts
// lib/permissions/roles.ts
export type Role = 'owner' | 'admin' | 'manager' | 'agent' | 'viewer';

export type Permission =
  | 'inbox:read' | 'inbox:reply' | 'inbox:assign' | 'inbox:close'
  | 'inbox:approve_reply'
  | 'reviews:read' | 'reviews:reply' | 'reviews:approve'
  | 'posts:create' | 'posts:publish' | 'posts:approve'
  | 'integrations:manage'
  | 'team:invite' | 'team:manage_roles'
  | 'billing:read' | 'billing:manage'
  | 'audit:read'
  | 'automations:manage'
  | 'ai:use_advanced'
  | 'ads:read'
  | 'listening:manage'
  | 'reports:create' | 'reports:export';

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = { /* ... */ };
```

```ts
// lib/permissions/can.ts
export async function can(userId: string, permission: Permission, context?: PermissionContext): Promise<boolean>;
export async function authorize(userId: string, permission: Permission, context?: PermissionContext): Promise<void>;
```

---

# 10. SISTEMA DE IA Y GUARDRAILS

## 10.1 Wrapper único

```ts
// lib/ai/client.ts
export async function aiCall<T>(opts: {
  kind: AIGenerationKind;
  organizationId: string;
  userId?: string;
  model: 'opus' | 'haiku';
  system: string;        // Cacheable
  messages: AIMessage[];
  schema?: z.ZodSchema<T>; // Si se pasa, parsea structured output
  cacheKey?: string;
  relatedEntity?: { type: string; id: string };
}): Promise<Result<T, AppError>>;
```

Este wrapper:
- Valida org context
- Aplica rate limit por org
- Aplica prompt caching de Anthropic
- Loguea en `ai_generations`
- Aplica `complianceCheck` cuando aplica
- Maneja retries
- Mide latencia y costo

## 10.2 Compliance check

```ts
// lib/ai/compliance.ts
export interface ComplianceResult {
  safe: boolean;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  flags: ComplianceFlag[];
  requiresApproval: boolean;
  reasoning: string;
}

export async function complianceCheck(
  text: string,
  context: { industry: string; entityType: string; orgPolicies: OrgPolicies }
): Promise<ComplianceResult>;
```

Flags posibles: `personal_data`, `legal_promise`, `financial_promise`, `medical_advice`, `minor_involved`, `discrimination`, `confidential_info`, `competitor_mention`, `pricing_claim`, `refund_promise`, `employee_named`, `aggressive_tone`, `crisis_topic`, `unverified_claim`.

## 10.3 Prompts cacheados

Todo system prompt vive en `lib/ai/prompts/` y se diseña para ser cacheable (parte estática grande, parte dinámica pequeña al final).

```ts
// lib/ai/prompts/reply-inbox.ts
export const replyInboxSystem = `
You are an assistant for Blacknel, a multi-platform business communication tool.
[... 2000 tokens de instrucciones estables ...]
`;

export function buildReplyInboxUserMessage(thread: InboxThread, brand: Brand): string { /* ... */ }
```

## 10.4 Modelos por tarea

| Tarea | Modelo | Razón |
|------|--------|-------|
| Clasificación de sentimiento | haiku | Barato, rápido |
| Detección de intención | haiku | Barato |
| Sugerencia de respuesta | opus | Calidad importa |
| Resumen de conversación | haiku | Suficiente |
| Compliance check | opus | Riesgo alto, vale la pena |
| Crisis detection | opus | Riesgo alto |
| Caption generation | haiku | Volumen alto |
| Report explanation | opus | Razonamiento complejo |
| Translation | haiku | Suficiente |

---

# 11. DISEÑO Y UX GUIDELINES

## 11.1 Principios

- **Calmado.** Paleta neutra, nada estridente.
- **Denso pero respirable.** Aprovecha el espacio, pero deja aire.
- **Acciones claras.** Cada pantalla tiene un CTA primario obvio.
- **Estados visibles.** El usuario siempre sabe en qué estado está cada entidad.
- **Filtros útiles.** Listas largas siempre tienen filtros y búsqueda.
- **Empty states con propósito.** Cada empty state explica qué pasará y cómo llegar.

## 11.2 Tokens (Tailwind config)

- Colores base: zinc/slate como neutros. Un accent corporativo definido en `tailwind.config.ts` como `brand` (TBD por el humano — propón gris-acero oscuro con un secundario de aviso, color exacto a confirmar).
- Tipografía: Inter para UI, JetBrains Mono para código/IDs/datos numéricos.
- Radius default: `lg` (8px).
- Sombras: muy sutiles.
- Spacing scale: la default de Tailwind.

## 11.3 Layout

- **Sidebar izquierdo** colapsable con secciones agrupadas:
  - Operación: Dashboard, Inbox, Approvals
  - Contenido: Publish, AI Studio
  - Reputación: Reviews, Reputation, Feedback
  - Inteligencia: Listening, Competitors, Ads, Reports
  - Configuración: Integrations, Locations, Team, Automations, Audit, Billing, Settings
- **Topbar** con: selector de marca, selector de ubicación, búsqueda global, notificaciones, avatar.
- **Breadcrumbs** dentro de cada módulo.
- **Panel lateral derecho** contextual (en Inbox, Reviews, Approvals).

## 11.4 Estados de entidades — colores semánticos

| Estado | Color |
|--------|-------|
| Draft / Pending | zinc |
| Scheduled / Pending approval | blue |
| Published / Approved / Resolved | emerald |
| Failed / Rejected | red |
| Urgent / Crisis | amber → red gradient |
| Closed / Archived | slate light |

## 11.5 Skeletons obligatorios

Cada lista, dashboard y panel tiene un skeleton que refleja la estructura final. Nunca un spinner solo.

## 11.6 Atajos de teclado

Desde Fase 4, definir cmd-k para búsqueda global, `j`/`k` para navegar listas en inbox, `r` para responder, `a` para asignar, `e` para escalar.

---

# 12. LAS 12 FASES — DETALLE QUIRÚRGICO

> **Regla de oro:** No avances a la siguiente fase sin que la actual esté **100% verificada**: `pnpm verify` limpio, todos los criterios de aceptación marcados, demo manual exitosa, README de fase actualizado.

---

## FASE 1 — Fundación web base

### 1.1 Objetivo

Crear la base del producto: estructura, navegación, layouts, dashboard vacío con esqueleto, modelo de datos base, autenticación, multi-tenancy, seed mínimo. **Sin** features de negocio funcionando todavía.

### 1.2 Scope IN

- Inicialización del proyecto: Next.js 16 + TS estricto + Tailwind v4 + shadcn/ui + ESLint + Prettier + Vitest
- Configuración de Supabase local con CLI
- Drizzle schema para: `organizations`, `users`, `organization_members`, `brands`, `locations`, `plans`, `subscriptions`, `audit_events`
- RLS en todas las tablas con `organization_id`
- Auth con Supabase (email + magic link, Google opcional)
- Layout principal con sidebar + topbar
- Las 19 rutas de la app creadas como placeholders con título + descripción + empty state
- Selector de marca y ubicación en topbar (con datos mock)
- Sistema de roles y `can()` funcionando para 3 permisos básicos
- Dark/light mode
- `lib/env.ts` con Zod
- `lib/log.ts`
- `lib/errors.ts`
- Audit log básico (registra logins)
- Seed script que crea la organización demo, 2 brands, 5 locations, 6 users

### 1.3 Scope OUT

- Inbox real
- Reviews reales
- Publishing real
- IA
- Reportes
- Onboarding flow
- Billing
- Conectores

### 1.4 Entregables

```
- Repo inicializado con todas las dependencias
- Supabase local corriendo con migraciones aplicadas
- pnpm dev levanta la app sin errores
- Puedes registrarte, hacer login, ver la app
- Sidebar muestra las 19 rutas, todas navegables
- Cada ruta muestra su título y un empty state coherente
- Selector de brand y location funciona (cambia el contexto en URL/state)
- Dark mode funciona
- pnpm verify pasa limpio
- README.md con instrucciones de setup
```

### 1.5 Archivos clave a crear

- `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `drizzle.config.ts`, `.env.example`
- `lib/env.ts`, `lib/log.ts`, `lib/errors.ts`, `lib/types/result.ts`
- `lib/db/client.ts`, `lib/db/schema/*.ts`
- `lib/auth/server.ts`, `lib/auth/middleware.ts`
- `lib/permissions/roles.ts`, `lib/permissions/can.ts`
- `app/layout.tsx`, `app/(marketing)/page.tsx`, `app/(marketing)/login/page.tsx`
- `app/(app)/layout.tsx` (shell con sidebar + topbar)
- 19 `app/(app)/<modulo>/page.tsx` con placeholder
- `components/layout/sidebar.tsx`, `components/layout/topbar.tsx`, `components/layout/shell.tsx`
- `components/ui/*` (shadcn copiados: button, card, dialog, input, select, dropdown, tooltip, badge, tabs, skeleton)
- `scripts/seed.ts`
- `tests/unit/permissions.test.ts`
- `tests/unit/plans.test.ts`
- `README.md`

### 1.6 Criterios de aceptación

1. **Setup:** un dev nuevo puede clonar el repo, correr `pnpm install && pnpm db:migrate && pnpm db:seed && pnpm dev` y ver la app sin pasos extras manuales.
2. **Auth:** un usuario nuevo puede registrarse, recibir magic link, hacer login.
3. **Tenancy:** un usuario solo ve su organization. RLS bloquea queries cross-tenant (test integration debe verificarlo).
4. **Navegación:** todas las 19 rutas son accesibles desde el sidebar.
5. **Empty states:** cada ruta tiene un empty state con título, descripción y un CTA (aunque sea "próximamente").
6. **Verify:** `pnpm verify` pasa con 0 warnings.
7. **Performance:** carga inicial < 2s en dev.

### 1.7 Tests obligatorios

- `permissions.test.ts`: verifica que cada rol tiene los permisos esperados
- `plans.test.ts`: verifica que `planAllowsFeature` devuelve lo correcto
- `rls.integration.test.ts`: verifica que un user de org A no puede leer brands de org B

### 1.8 Definition of Done

```
[ ] Todas las dependencias instaladas, sin vulnerabilidades altas
[ ] pnpm verify pasa
[ ] Seed crea data demo correctamente
[ ] Login + navegación funcional
[ ] Sidebar muestra estado activo en ruta actual
[ ] Empty states implementados en las 19 rutas
[ ] README actualizado
[ ] Demo manual grabada/probada con el humano
```

---

## FASE 2 — Onboarding y billing conceptual

### 2.1 Objetivo

Permitir que un usuario nuevo entre, elija plan, configure organización/marca/ubicación, invite equipo y vea su primer dashboard. Billing es **conceptual** (sin Stripe real).

### 2.2 Scope IN

- Pantalla pública de pricing con los 3 planes
- Flujo de onboarding multi-step:
  1. Crear organización (nombre, país, locale, timezone)
  2. Elegir plan
  3. Crear primera marca (nombre, logo opcional, brand voice básico)
  4. Crear primera ubicación
  5. Conectar primera red (mock, ver Fase 3 — aquí solo placeholder con "lo haremos en el siguiente paso")
  6. Invitar equipo (opcional)
  7. Ver checklist de configuración
- Checklist de onboarding visible en el dashboard hasta completarse
- Página de Billing conceptual: muestra plan actual, uso vs límites, botón de upgrade que cambia el plan en DB
- `usage_counters` actualizándose para métricas básicas (cuentas conectadas, ubicaciones, usuarios)
- Feature gating funcional en UI y servidor
- Upgrade prompts cuando se intenta usar algo fuera del plan
- Invitaciones funcionando con emails de Resend

### 2.3 Scope OUT

- Stripe real
- Webhooks de Stripe
- Facturas
- Pago en línea

### 2.4 Entregables

```
- Página /pricing pública con 3 planes claros
- Flujo de onboarding completo
- Checklist en dashboard
- Página de Billing con plan actual, uso, botón "Cambiar plan"
- Página de Team con invitaciones funcionando
- Feature gating en al menos 5 features visibles
- Resend enviando emails de invitación (en dev, a mailcatcher)
```

### 2.5 Archivos clave

- `app/(marketing)/pricing/page.tsx`
- `app/(onboarding)/onboarding/page.tsx` y sus steps
- `app/(app)/billing/page.tsx`
- `app/(app)/team/page.tsx`
- `app/(app)/team/actions.ts` (invite, removeMember, changeRole)
- `lib/plans/plans.ts`, `lib/plans/gating.ts`, `lib/plans/limits.ts`
- `components/billing/usage-card.tsx`
- `components/billing/plan-comparison.tsx`
- `components/onboarding/*`
- `components/feature-gate.tsx`, `components/upgrade-prompt.tsx`
- `lib/emails/invite.tsx` (React Email template)

### 2.6 Criterios de aceptación

1. Un usuario nuevo completa onboarding y aterriza en dashboard con checklist visible.
2. Cambiar plan desde Billing actualiza features inmediatamente (gating se ajusta).
3. Intentar conectar una sexta cuenta social en plan Standard muestra `UpgradePrompt`.
4. Invitar un usuario envía email con magic link de Resend.
5. El checklist se marca automáticamente cuando se completa cada paso.
6. `pnpm verify` pasa.

### 2.7 Tests obligatorios

- `gating.test.ts`: verifica `requireFeature` lanza error correcto
- `limits.test.ts`: verifica `checkLimit` con casos límite
- `onboarding.integration.test.ts`: completa el flujo end-to-end

---

## FASE 3 — Integrations Center

### 3.1 Objetivo

Crear el centro de integraciones donde el usuario conecta cuentas (todas mock por ahora), ve estado, capabilities, errores, asigna a brands/locations. La UI debe sentirse igual a producción — solo cambia que los conectores son `mock`.

### 3.2 Scope IN

- Página `/integrations` con grid de plataformas disponibles
- Filtro de plataformas por plan (visualmente bloqueadas las no incluidas con upgrade prompt)
- Modal de "conectar" que simula OAuth (en mock-mode crea un `connected_account` con capabilities predefinidas por plataforma)
- Vista detalle de cuenta conectada con:
  - Estado, último sync, errores
  - Capabilities habilitadas con tooltip explicativo
  - Botón "reconectar", "desconectar", "test connection", "sync now"
  - Asignación a brand y location
- Listado de cuentas conectadas con estados visibles
- Cron mock que cada N minutos cambia algunas cuentas a estado `expired` o `error` (controlable por env var)
- Implementación de los 16 conectores en modo mock con capabilities realistas:
  - facebook: read_comments, reply_comments, read_dms, send_dms, publish_post, schedule_post, read_insights
  - instagram: read_comments, reply_comments, read_dms (limitado), send_dms (limitado), publish_post, schedule_post, read_insights
  - gbp: read_reviews, reply_reviews, read_insights, send_review_request
  - whatsapp: read_dms, send_dms (con plantillas), read_insights
  - tiktok: read_comments, reply_comments, publish_post, schedule_post, read_insights
  - linkedin: publish_post, schedule_post (Growth: básico), read_insights
  - x: publish_post, schedule_post, read_dms, send_dms, read_mentions
  - yelp: read_reviews (sin reply — mostrar capability note explicando limitación)
  - tripadvisor: read_reviews, reply_reviews
  - trustpilot: read_reviews, reply_reviews
  - bbb: read_reviews (con nota: importación manual)
  - avvo: read_reviews (con nota: scraping legal pendiente)
  - youtube: read_comments, reply_comments, read_insights
  - pinterest: publish_post, schedule_post
  - reddit: read_mentions, listening

### 3.3 Scope OUT

- OAuth real con cualquier plataforma
- Sincronización real de datos
- Ads connectors (Fase 10)

### 3.4 Entregables

```
- Página /integrations con grid completo
- 16 conectores mock funcionales
- Estados de conexión y errores visibles
- Asignación a brand/location
- Sync manual disparable
- Capability notes claras donde la plataforma limita
- Plan-gating visible
```

### 3.5 Archivos clave

- `app/(app)/integrations/page.tsx`
- `app/(app)/integrations/[accountId]/page.tsx`
- `app/(app)/integrations/actions.ts`
- `lib/connectors/base/types.ts`, `lib/connectors/base/connector.ts`
- `lib/connectors/registry.ts`
- `lib/connectors/<platform>/index.ts` × 16
- `lib/connectors/<platform>/mock.ts` × 16
- `lib/connectors/<platform>/capabilities.ts` × 16
- `components/integrations/platform-card.tsx`
- `components/integrations/account-detail.tsx`
- `components/integrations/connect-modal.tsx`
- `lib/jobs/sync-account.ts` (Inngest function en mock mode)

### 3.6 Criterios de aceptación

1. Conectar una cuenta mock toma <2 segundos y se ve real.
2. Cada plataforma muestra sus capabilities con explicación de límites.
3. Yelp NO muestra botón "reply" en reviews (capability ausente).
4. Una cuenta en estado `expired` muestra banner "Reconectar" claro.
5. Cambiar de plan habilita/bloquea plataformas en el grid.
6. `pnpm verify` pasa.

### 3.7 Tests

- `connectors.test.ts`: registry resuelve cada platform correctamente
- `capabilities.test.ts`: capability flags por platform son los esperados
- `mock-connector.test.ts`: mock connector se comporta deterministicamente con seed

---

## FASE 4 — Inbox unificado (CORAZÓN DEL PRODUCTO)

### 4.1 Objetivo

Construir el módulo más crítico de Blacknel. El inbox debe ser productivo, rápido y funcionar para múltiples canales de manera unificada.

### 4.2 Scope IN

- Listado de threads con virtualización (react-virtuoso)
- Filtros: red, marca, ubicación, asignado, estado, prioridad, sentimiento, kind, tags, búsqueda full-text
- Detalle de thread con:
  - Historial de mensajes
  - Composer de respuesta (con plantillas, IA, idiomas)
  - Panel lateral derecho contextual con: contacto, ubicación, asignación, SLA, tags, sentimiento, prioridad, notas internas, historial del contacto
- Acciones: responder, asignar, cerrar, reabrir, escalar, marcar spam, cambiar prioridad, agregar tag, agregar nota interna
- Plantillas (saved replies) con variables seguras
- Sugerencias de IA en composer (botón "Sugerir respuesta")
- Compliance check antes de enviar respuesta (advertencia o bloqueo según severidad)
- Approvals para respuestas marcadas como sensibles
- SLA básico: tiempo hasta primera respuesta
- Realtime updates con Supabase Realtime (nuevos mensajes aparecen sin refresh)
- Cron mock que cada cierto tiempo agrega mensajes nuevos
- Atajos de teclado: `j/k`, `r`, `a`, `e`, `c`, `cmd+k`

### 4.3 Scope OUT

- WhatsApp real (mock por ahora)
- Reviews en inbox (van en Fase 5, módulo aparte)
- Listening mentions en inbox (Fase 9)

### 4.4 Entregables

```
- Inbox funcional con threads mock realistas
- Composer con plantillas + IA + compliance
- Approvals para respuestas sensibles
- Atajos de teclado
- Realtime updates
- Empty states bien diseñados
- Performance: lista de 500 threads sin lag
```

### 4.5 Archivos clave

- `app/(app)/inbox/page.tsx`
- `app/(app)/inbox/[threadId]/page.tsx`
- `app/(app)/inbox/actions.ts`
- `components/inbox/thread-list.tsx` (virtualizada)
- `components/inbox/thread-detail.tsx`
- `components/inbox/composer.tsx`
- `components/inbox/context-panel.tsx`
- `components/inbox/filters.tsx`
- `components/inbox/saved-replies-picker.tsx`
- `components/inbox/ai-suggest-button.tsx`
- `lib/inbox/queries.ts`, `lib/inbox/actions.ts`
- `lib/ai/prompts/reply-inbox.ts`
- `lib/ai/sentiment.ts`, `lib/ai/intent.ts`
- `lib/realtime/inbox.ts`
- `lib/jobs/generate-inbox-mocks.ts`

### 4.6 Criterios de aceptación

1. Abrir un thread carga en <300ms.
2. Responder un mensaje toma <2s (incluyendo compliance check).
3. La IA sugiere respuestas coherentes con el contexto del thread.
4. Una respuesta con riesgo alto bloquea envío y crea approval.
5. Atajos de teclado funcionan en thread detail.
6. Mensajes nuevos aparecen sin refresh.
7. Filtros combinados funcionan correctamente.
8. Buscar por texto encuentra threads.
9. `pnpm verify` pasa.

### 4.7 Tests obligatorios

- `inbox-actions.test.ts`: assign, close, reopen, escalate
- `compliance.test.ts`: detecta correctamente flags en respuestas problemáticas
- `saved-replies.test.ts`: variables se sustituyen, no se permiten variables inseguras
- `inbox.integration.test.ts`: flujo completo de respuesta con approval

---

## FASE 5 — Reviews y Reputation

### 5.1 Objetivo

Centralizar reseñas de todas las plataformas mock con respuesta asistida por IA, approvals para negativas, dashboard de reputación.

### 5.2 Scope IN

- Página `/reviews` con listado y filtros (rating, plataforma, ubicación, sentimiento, estado, asignado)
- Detalle de review con:
  - Texto original
  - Autor
  - Plataforma con link al original
  - Composer de respuesta con IA
  - Approval flow para reviews ≤ 3 estrellas o con flags de compliance
  - Historial de respuesta
- Asignación, escalado, tags, notas internas
- Reviews positivas: IA sugiere respuesta breve, agradecida
- Reviews negativas: IA sugiere respuesta empática + escalada interna obligatoria
- Página `/reputation` con:
  - Rating promedio total
  - Rating por ubicación
  - Rating por plataforma
  - Evolución temporal (30/90/365 días)
  - Reseñas sin responder
  - Tiempo promedio de respuesta
  - Temas frecuentes (extracted por IA)
  - Comparativa entre ubicaciones
  - Alertas de caída de reputación
- Review requests:
  - Crear campaña de review request
  - Enviar por email (Resend) — SMS y WhatsApp quedan en Growth
  - Landing pública de feedback (positive → redirige a Google review, negative → captura privado)
  - Tracking de aperturas y completaciones

### 5.3 Scope OUT

- APIs reales de plataformas de reviews
- SMS / WhatsApp en review requests (Fase 9)

### 5.4 Entregables

```
- /reviews funcional con 80+ reviews mock
- /reputation con métricas correctas
- Approvals para reviews negativas
- Review request por email funcionando
- Landing pública de feedback
- IA generando respuestas adecuadas
```

### 5.5 Archivos clave

- `app/(app)/reviews/page.tsx`, `app/(app)/reviews/[id]/page.tsx`, `app/(app)/reviews/actions.ts`
- `app/(app)/reputation/page.tsx`
- `app/(app)/reviews/requests/page.tsx`, `app/(app)/reviews/requests/[id]/page.tsx`
- `app/(public)/feedback/[token]/page.tsx` (landing pública)
- `components/reviews/*`
- `components/reputation/*`
- `lib/reviews/queries.ts`, `lib/reviews/actions.ts`, `lib/reviews/reputation.ts`
- `lib/ai/prompts/reply-review.ts`

### 5.6 Criterios de aceptación

1. Reviews mock realistas en 4+ plataformas distintas.
2. Yelp NO muestra botón "reply" (capability ausente — coherente con Fase 3).
3. Una review de 1 estrella genera approval automáticamente.
4. /reputation muestra métricas correctas y consistentes.
5. Review request completo: enviar → abrir → completar → ver resultado en dashboard.
6. Landing pública no requiere auth, funciona en mobile.
7. `pnpm verify` pasa.

---

## FASE 6 — Publishing y Calendar

### 6.1 Objetivo

Permitir crear, programar y publicar contenido en múltiples redes desde un composer unificado con previews por plataforma.

### 6.2 Scope IN

- Composer multi-red con:
  - Selector de cuentas destino
  - Variaciones de texto por red (heredan del base)
  - Subida de media a Supabase Storage
  - Preview en tiempo real por plataforma
  - Programación con timezone correcto
  - UTM builder
  - Sugerencias de horario (placeholder, refinado en Fase 8)
  - IA para captions
- Calendario mensual / semanal / lista
- Vistas: borradores, programados, publicados, fallidos
- Aprobación antes de publicar (configurable por brand)
- Campaigns: agrupar posts en campañas con objetivo
- Asset library básica
- Job de publicación (Inngest): toma post programado, llama al conector, registra resultado, reintenta si falla con backoff
- Idempotencia: cada `post_target` tiene `idempotency_key` para no duplicar
- Límite de posts por mes según plan, contado en `usage_counters`

### 6.3 Scope OUT

- Publicación real (mock por ahora)
- Best time to post analytics (Fase 8)
- Bulk upload via CSV (Fase 12)

### 6.4 Entregables

```
- Composer funcional con previews por red
- Calendario con drag-and-drop básico
- Publishing job funcional (mock)
- Approvals para posts importantes
- Asset library con uploads
- Campaigns agrupando posts
- Usage counters actualizándose correctamente
```

### 6.5 Archivos clave

- `app/(app)/publish/page.tsx` (calendario)
- `app/(app)/publish/composer/page.tsx`
- `app/(app)/publish/composer/[id]/page.tsx`
- `app/(app)/publish/campaigns/*`
- `app/(app)/publish/assets/*`
- `components/publish/composer.tsx`
- `components/publish/calendar-view.tsx`
- `components/publish/preview-*.tsx` (uno por plataforma)
- `lib/publish/queries.ts`, `lib/publish/actions.ts`
- `lib/jobs/publish-post.ts` (Inngest)
- `lib/ai/prompts/generate-caption.ts`

### 6.6 Criterios de aceptación

1. Crear un post para 3 redes con variaciones funciona.
2. Previews son fieles a cada plataforma (dimensiones, longitud, etc.).
3. Programar para futuro lo ejecuta a la hora correcta.
4. Si falla, se reintenta hasta 3 veces y luego marca `failed` con razón clara.
5. No se puede crear un post 31 en plan Standard sin upgrade prompt.
6. Idempotencia: ejecutar el job dos veces no duplica el post.
7. `pnpm verify` pasa.

---

## FASE 7 — IA útil en todos los flujos

### 7.1 Objetivo

Llevar la IA de "sugerencia en inbox/reviews" a estar presente útilmente en todos los flujos donde aporte valor. Sin volverse molesta.

### 7.2 Scope IN

- **Inbox:**
  - Resumen de conversación (botón "Resumir")
  - Acciones recomendadas
  - Detección de lead, queja, urgencia
  - Mejorar tono / acortar / traducir respuesta
- **Reviews:**
  - Mejora de respuesta
  - Extracción de temas
- **Publishing:**
  - Generar caption desde imagen/contexto
  - Adaptar caption por red
  - Hashtags relevantes
  - Compliance check antes de publicar
- **Reports (preview de Fase 8):**
  - "Explain this metric" en gráficos
- **Crisis detection:**
  - Job que corre cada hora analizando inbox + reviews + listening (placeholder)
  - Detecta patrones: aumento súbito de negativas, queja viral, tema sensible repetido
  - Crea `crisis_alerts` con severidad y resumen
- **Brand voice:**
  - Página `/settings/brand-voice` por brand
  - La voz se inyecta en todos los prompts
- **AI generation log:**
  - Página `/audit/ai` con todas las generaciones, costos, modelos

### 7.3 Scope OUT

- AI Content Studio completo (Fase 10)
- Auto-tagging masivo

### 7.4 Entregables

```
- IA presente en al menos 12 puntos de la UI
- Brand voice configurable y aplicado
- Crisis detection corriendo y creando alertas
- AI log auditado con costos
- Prompts cacheados correctamente (verificable en logs)
- Compliance check ejecutándose donde aplique
```

### 7.5 Archivos clave

- `lib/ai/prompts/*` (todos los prompts del producto)
- `lib/ai/crisis.ts`
- `lib/jobs/detect-crisis.ts` (Inngest cron)
- `app/(app)/audit/ai/page.tsx`
- `app/(app)/settings/brand-voice/page.tsx`
- `components/ai/suggest-button.tsx`, `components/ai/improve-tone.tsx`, etc.

### 7.6 Criterios de aceptación

1. Costo promedio por organización debajo de presupuesto definido (TBD con el humano).
2. Prompt caching ahorra >50% en tokens de system prompt.
3. Crisis detection genera alerta en escenario de prueba (10 reviews de 1 estrella en 24h).
4. Brand voice se refleja en respuestas generadas.
5. `pnpm verify` pasa.

---

## FASE 8 — Reports

### 8.1 Objetivo

Proveer reportes claros que demuestren valor del producto.

### 8.2 Scope IN

- Página `/reports` con:
  - Dashboard ejecutivo (overview)
  - Reporte de Inbox
  - Reporte de Reviews
  - Reporte de Publishing
  - Reporte por ubicación
  - Reporte por red
  - Reporte de SLA
- Filtros: rango de fechas (con presets: 7d, 30d, 90d, custom), brand, location, plataforma, campaign
- Gráficas con Recharts (líneas, barras, donas, heatmap)
- Export a CSV y PDF (server-side render con `@react-pdf/renderer`)
- "Explain this spike" en cada gráfico — IA explica cambios
- Reportes programados con Inngest cron (semanal/mensual) enviados por Resend a destinatarios

### 8.3 Scope OUT

- Report Builder custom (Fase 10)
- Embedded analytics
- White-label

### 8.4 Entregables

```
- 7 reportes funcionales con datos consistentes
- Export CSV/PDF funcional
- "Explain this spike" con IA
- Reportes programados enviándose
```

### 8.5 Archivos clave

- `app/(app)/reports/page.tsx` y subrutas por tipo
- `lib/reports/queries.ts`, `lib/reports/builders.ts`
- `lib/reports/pdf/*.tsx` (templates de React PDF)
- `lib/jobs/scheduled-report.ts`
- `components/reports/chart-*.tsx`
- `lib/ai/prompts/explain-metric.ts`

### 8.6 Criterios de aceptación

1. Cambiar rango de fecha actualiza todos los gráficos consistentemente.
2. PDF generado se ve bien y tiene branding correcto.
3. "Explain this spike" da una explicación razonable basada en datos reales.
4. Reporte programado llega por email en formato PDF.
5. `pnpm verify` pasa.

---

## FASE 9 — Growth features

### 9.1 Objetivo

Completar el plan Growth para justificar $299/mes.

### 9.2 Scope IN

- **WhatsApp Business (mock completo):**
  - Inbox unificado con WhatsApp threads
  - Templates de mensajes
  - Opt-in / opt-out tracking
- **TikTok (mock completo):**
  - Publishing
  - Comments / DMs en inbox
- **LinkedIn básico (mock):**
  - Publishing
  - Insights
- **Multi-location fuerte:**
  - Dashboard por ubicación
  - Reports por ubicación con comparativas
  - Permisos scoped a ubicación
  - Reviews agrupadas por ubicación
- **NPS básico:**
  - Crear campaña NPS
  - Enviar encuesta
  - Dashboard de NPS con distribución (promoter/passive/detractor)
  - Promoters → CTA para review request
  - Detractors → escalada interna obligatoria
- **Approval flow completo:**
  - Página `/approvals` con cola
  - Reglas configurables: qué requiere aprobación, quién aprueba
- **Social listening básico:**
  - Keywords simples
  - Menciones de marca
  - Alertas básicas
  - 1 fuente: Reddit (mock)
- **Competitor tracking básico:**
  - Registrar 3 competidores
  - Snapshots diarios mock
  - Comparativa de followers/engagement/rating
- **Notas internas avanzadas:**
  - @mentions con notificaciones
  - Pinned notes
- **Asignación inteligente:**
  - Round-robin por equipo
  - Reglas por brand/location

### 9.3 Scope OUT

- Listening avanzado (Fase 10)
- Competitor benchmarking deep (Fase 10)
- Ads (Fase 10)

### 9.4 Criterios de aceptación

1. WhatsApp threads aparecen en inbox unificado igual que otros.
2. NPS campaign completo: crear → enviar → recibir respuestas → ver dashboard.
3. Detractor genera approval / escalada visible en /approvals.
4. Cambiar a plan Growth desbloquea todo esto inmediatamente.
5. `pnpm verify` pasa.

---

## FASE 10 — Enterprise features

### 10.1 Objetivo

Completar Enterprise para justificar $1,099/mes.

### 10.2 Scope IN

- **X / Twitter (mock completo)**
- **LinkedIn avanzado (mock):** company pages, ads insights
- **TripAdvisor, Yelp, Trustpilot, BBB, Avvo (mock):** reviews import
- **YouTube (mock):** comments management, insights
- **Pinterest (mock):** publishing
- **Reddit (mock):** listening + comments management
- **Listening avanzado:**
  - Boolean queries
  - Topics con múltiples keywords
  - Sentiment trends
  - Share of voice vs competidores
  - Volume alerts
  - Web mentions, news, blogs, RSS (mock)
- **Ads Intelligence (mock):**
  - Meta, Google, TikTok, LinkedIn, X
  - Métricas, alertas, recomendaciones (sin auto-pause)
- **AI Content Studio:**
  - Ideas de contenido
  - Scripts de video
  - Repurpose desde reviews/menciones
  - Brand voice fine-tuning
  - Compliance batch check
- **Report Builder custom:**
  - Drag-and-drop de secciones
  - Métricas configurables
  - Programación
  - Templates guardables
- **Permisos granulares:**
  - Roles custom por organización
  - Permisos a nivel ubicación/marca
- **Audit log completo:**
  - Filtros avanzados
  - Export
  - Diferencias before/after
- **SLA avanzado:**
  - Reglas por horario laboral, prioridad, red
  - Dashboards de cumplimiento
  - Alertas de breach
- **Crisis center:**
  - Página dedicada con timeline, sources, equipo asignado
  - Workflow de gestión
- **Competitor benchmarking avanzado:**
  - Análisis con IA
  - Recomendaciones de contenido
  - Detección de oportunidades

### 10.3 Criterios de aceptación

1. Enterprise se siente significativamente más poderoso que Growth.
2. Listening boolean query funciona y filtra correctamente.
3. Report builder genera reportes custom enviables.
4. Crisis center maneja un caso completo end-to-end.
5. `pnpm verify` pasa.

---

## FASE 11 — Integraciones reales

### 11.1 Objetivo

Reemplazar conectores mock por implementaciones reales **gradualmente**, sin romper la UI.

### 11.2 Orden estricto (no cambiar)

1. **Meta Graph API** (Facebook + Instagram + Messenger)
2. **Google Business Profile API**
3. **WhatsApp Business Cloud API**
4. **TikTok Business API**
5. **LinkedIn Marketing API**
6. **X API v2**
7. **Yelp Fusion** (solo read, ya esperado)
8. **TripAdvisor API**
9. **Trustpilot API**
10. **BBB:** importación manual CSV oficial (no hay API)
11. **Avvo:** scraping legal con respeto a robots.txt + ToS (pendiente análisis legal)
12. **YouTube Data API**
13. **Pinterest API**
14. **Reddit API**
15. **Ads APIs**

### 11.3 Por cada integración

- OAuth real con manejo de refresh tokens
- Webhooks donde aplique (Meta, WhatsApp)
- Rate limiting respetando límites de la plataforma
- Sync inicial + delta sync con Inngest
- Manejo de errores específicos por plataforma
- Reconexión automática cuando posible
- Tests con sandbox/test accounts de cada plataforma
- Documentación de scopes solicitados
- App reviews submitted en plataformas que lo requieran

### 11.4 Reglas

- **Nunca** quitar el mock connector. Sigue siendo útil para tests y demos.
- Si la API real cae, el sistema debe degradar correctamente, no caerse.
- Cada integración tiene su propia feature flag para activar/desactivar en producción.
- Webhooks deben verificar firmas siempre.
- Tokens cifrados at-rest con `pgcrypto` o Supabase Vault.

### 11.5 Criterios de aceptación por integración

1. OAuth completo funciona end-to-end.
2. Capabilities reales coinciden con lo declarado.
3. Webhook entrega y procesa eventos correctamente con idempotencia.
4. Sync inicial completa sin perder datos.
5. Refresh de token automático.
6. Reconexión clara cuando expira.
7. Tests integration con sandbox pasan.
8. `pnpm verify` pasa.

---

## FASE 12 — Polish comercial y lanzamiento

### 12.1 Objetivo

Dejar el producto listo para vender: marketing site, billing real, performance, seguridad, soporte.

### 12.2 Scope IN

- **Marketing site:**
  - Landing principal con valor claro
  - Pricing page pulida
  - Página por industria (restaurantes, clínicas, hoteles, agencias, etc.)
  - Comparativas con Hootsuite, Sprout, Birdeye (factuales)
  - Casos de estudio (3-5 mockups)
  - Centro de ayuda básico
- **Billing real con Stripe:**
  - Checkout
  - Customer portal
  - Webhooks
  - Manejo de fallos de pago
  - Pruebas con cuentas test de Stripe
- **Onboarding pulido:**
  - Tour guiado opcional
  - Tooltips contextuales
  - Empty states pulidos
  - Loading states pulidos
- **Performance:**
  - Lighthouse score >90 en app
  - LCP <2.5s
  - INP <200ms
  - Imágenes optimizadas con next/image
  - Code splitting agresivo
- **Seguridad:**
  - Audit de RLS
  - Audit de permisos
  - Pen test básico
  - Rate limiting en endpoints públicos
  - CSP estricta
  - Cookies seguras
- **Observabilidad:**
  - Sentry configurado en producción
  - PostHog con eventos clave
  - Alertas de uptime
- **SEO:**
  - Sitemap
  - Open Graph
  - Schema.org
- **Legal:**
  - Términos de servicio
  - Política de privacidad
  - DPA template para clientes empresa
  - Cookie banner
- **Soporte:**
  - Help center con artículos básicos
  - Widget de chat (Intercom o similar)
  - Email de soporte

### 12.3 Criterios de aceptación finales

1. Un usuario externo puede registrarse, pagar, configurar todo y usar el producto sin asistencia.
2. Lighthouse >90 en pricing page y dashboard.
3. Zero crashes durante demo de 1 hora con datos reales.
4. Stripe webhooks idempotentes verificados.
5. RLS validado con auditoría externa o tests exhaustivos.
6. `pnpm verify` pasa.
7. Producto puede demostrarse a un prospecto real con confianza.

---

# 13. CHECKLIST GLOBAL DE CALIDAD

Antes de marcar **cualquier** fase como terminada:

```
[ ] pnpm install limpio sin warnings críticos
[ ] pnpm lint sin warnings ni errores
[ ] pnpm typecheck sin errores
[ ] pnpm test todos verdes
[ ] pnpm build exitoso
[ ] pnpm db:migrate aplicado limpio en DB nueva
[ ] pnpm db:seed exitoso
[ ] App levanta y se navega sin errores en consola
[ ] Sin console.log dejados en código
[ ] Sin TODOs sin issue tracker referenciado
[ ] Sin secretos hardcodeados
[ ] Sin `any` sin FIXME
[ ] README actualizado con cambios de la fase
[ ] CHANGELOG.md actualizado
[ ] Migraciones de DB en orden cronológico correcto
[ ] Tests de regresión de fases anteriores siguen pasando
[ ] Performance no degradado (medible)
[ ] Demo manual con el humano exitosa
[ ] Estados vacíos coherentes en pantallas nuevas
[ ] Estados de error con acción de recuperación
[ ] Loading states con skeletons
[ ] Permisos verificados en server, no solo UI
[ ] Feature gating verificado en server, no solo UI
[ ] RLS verificado para nuevas tablas
```

---

# 14. CÓMO EMPEZAR Y TERMINAR CADA FASE

## 14.1 Empezar una fase

Antes de tocar código:

1. **Lee este documento completo otra vez** (sí, completo — no asumas que recuerdas).
2. **Lee la sección específica de la fase** que vas a ejecutar.
3. **Lista los archivos que vas a crear o modificar** y muéstrame la lista para confirmar.
4. **Lista las dependencias nuevas** que vas a instalar y muéstrame la lista para confirmar.
5. **Lista los riesgos** que ves para esta fase específica.
6. **Pregunta cualquier ambigüedad** antes de avanzar.

Solo después de mi confirmación explícita, empieza a escribir código.

## 14.2 Durante una fase

- Trabaja en commits pequeños y descriptivos: `feat(inbox): add thread list virtualization`
- Crea PRs (o branches si no usamos GitHub aún) por subfeature: ej. dentro de Fase 4, separa "lista de threads", "detalle de thread", "composer", "compliance".
- Después de cada subfeature, corre `pnpm verify` y muéstrame el output.
- Si algo del documento te parece incorrecto o desactualizado, **dilo** — no lo cambies en silencio.
- Si encuentras un trade-off no resuelto, pregunta antes de decidir.

## 14.3 Terminar una fase

1. Corre el checklist global de calidad completo.
2. Corre `pnpm verify` y comparte output.
3. Graba (o describe) un demo manual de los flujos críticos.
4. Actualiza `CHANGELOG.md` con todo lo entregado.
5. Actualiza `README.md` si hay nuevos pasos de setup.
6. Confirma conmigo que la fase está cerrada antes de empezar la siguiente.

---

# 15. REGLAS DE COMUNICACIÓN ENTRE CLAUDE CODE Y EL HUMANO

## 15.1 Cuándo preguntar al humano

- Cuando un requisito sea ambiguo
- Cuando veas un trade-off importante (performance vs simplicidad, etc.)
- Cuando una decisión de producto no esté en este documento
- Cuando una dependencia externa esté caída o sea inestable
- Cuando algo huela a violación de las reglas no negociables
- Antes de instalar paquetes pesados nuevos (>1MB minified)
- Antes de cambiar el stack
- Antes de hacer migraciones destructivas

## 15.2 Cuándo NO preguntar

- Decisiones de naming dentro de convenciones
- Decisiones internas de implementación que cumplen los criterios
- Refactors menores
- Bug fixes obvios
- Mejoras de tests

## 15.3 Cómo reportar progreso

Al final de cada sesión de trabajo, da un resumen así:

```
## Progreso Fase X

Completado:
- Tarea 1
- Tarea 2

En curso:
- Tarea 3 — falta Y

Pendiente:
- Tarea 4

Bloqueos:
- Ninguno / Descripción

Próximo paso sugerido:
- ...

pnpm verify: pasa
```

## 15.4 Honestidad

- **No marques tareas como completas si no lo están.**
- **No inventes que algo funciona si no lo probaste.**
- **No escondas errores.**
- **Si te equivocas, repórtalo y propón fix.**

---

# 16. PRIMERA ACCIÓN ESPERADA

Antes de escribir cualquier línea de código, responde con:

1. **Confirmación de identidad:** "El producto se llama Blacknel. Voy a construirlo en 12 fases."
2. **Resumen del stack** que vas a usar (verbatim de la sección 2, para confirmar que lo entendiste).
3. **Plan detallado de Fase 1** con la lista de archivos exactos que vas a crear.
4. **Lista de dependencias** que vas a instalar con versión exacta.
5. **Riesgos que ves en Fase 1** específicamente.
6. **Cualquier pregunta** que tengas antes de arrancar.

**No instales nada, no crees nada, no toques nada hasta que el humano confirme tu plan.**

Una vez confirmado, ejecuta Fase 1 con la disciplina descrita en la sección 14.

---

# 17. NOTAS FINALES

- Este documento es la fuente de verdad del proyecto. Si encuentras contradicciones internas, pregunta. Si el humano contradice este documento en una conversación, **gana este documento** salvo que el humano edite explícitamente este archivo.
- Trata cada fase como un mini-proyecto serio, no como un sprint apresurado.
- Calidad > velocidad. Blacknel se vende a empresas que esperan profesionalismo — el código tiene que reflejarlo.
- Diversión y pulido en igual medida. Quiero que cuando un cliente vea Blacknel, piense "esto se siente diferente".

— Fin del documento maestro —

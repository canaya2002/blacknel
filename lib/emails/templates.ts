/**
 * Typed, bilingual (es/en) transactional email templates (Phase 11 / C44).
 *
 * Plain typed HTML strings (not @react-email) — fewer deps, trivially testable,
 * enough for these 4 transactional templates. Each template declares its data
 * shape (compile-time checked) and renders { subject, html, text } per locale.
 * The magic-link sign-in stays in Supabase Auth; these are everything else.
 */

export type EmailTemplate =
  | 'team_invite'
  | 'billing_notification'
  | 'data_deletion_confirmation'
  | 'generic_notification';

export type EmailLocale = 'es' | 'en';

export interface TemplateData {
  team_invite: {
    readonly orgName: string;
    readonly inviterName: string;
    readonly acceptUrl: string;
  };
  billing_notification: {
    readonly orgName: string;
    readonly message: string;
  };
  data_deletion_confirmation: {
    readonly requestCode: string;
    readonly statusUrl: string;
  };
  generic_notification: {
    readonly title: string;
    readonly body: string;
    readonly ctaUrl?: string;
    readonly ctaLabel?: string;
  };
}

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/** Escape user-provided values before interpolating into HTML. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrap(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#18181b;line-height:1.5">
<div style="max-width:560px;margin:0 auto;padding:24px">
<h1 style="font-size:18px;margin:0 0 16px">${esc(title)}</h1>
${bodyHtml}
<hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0"/>
<p style="font-size:12px;color:#71717a">Blacknel</p>
</div></body></html>`;
}

function button(url: string, label: string): string {
  return `<p><a href="${esc(url)}" style="display:inline-block;background:#18181b;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${esc(label)}</a></p>`;
}

export function renderTemplate<T extends EmailTemplate>(
  template: T,
  locale: EmailLocale,
  data: TemplateData[T],
): RenderedEmail {
  const es = locale === 'es';
  switch (template) {
    case 'team_invite': {
      const d = data as TemplateData['team_invite'];
      const subject = es
        ? `${d.inviterName} te invitó a ${d.orgName} en Blacknel`
        : `${d.inviterName} invited you to ${d.orgName} on Blacknel`;
      const intro = es
        ? `${esc(d.inviterName)} te invitó a unirte al equipo de <strong>${esc(d.orgName)}</strong>.`
        : `${esc(d.inviterName)} invited you to join the <strong>${esc(d.orgName)}</strong> team.`;
      const label = es ? 'Aceptar invitación' : 'Accept invitation';
      const text = es
        ? `${d.inviterName} te invitó a ${d.orgName}. Aceptá: ${d.acceptUrl}`
        : `${d.inviterName} invited you to ${d.orgName}. Accept: ${d.acceptUrl}`;
      return {
        subject,
        html: wrap(subject, `<p>${intro}</p>${button(d.acceptUrl, label)}`),
        text,
      };
    }
    case 'billing_notification': {
      const d = data as TemplateData['billing_notification'];
      const subject = es
        ? `Facturación — ${d.orgName}`
        : `Billing — ${d.orgName}`;
      const text = `${subject}\n\n${d.message}`;
      return { subject, html: wrap(subject, `<p>${esc(d.message)}</p>`), text };
    }
    case 'data_deletion_confirmation': {
      const d = data as TemplateData['data_deletion_confirmation'];
      const subject = es
        ? 'Confirmación de solicitud de eliminación de datos'
        : 'Data deletion request confirmation';
      const intro = es
        ? `Recibimos tu solicitud de eliminación de datos. Código: <strong>${esc(d.requestCode)}</strong>.`
        : `We received your data deletion request. Code: <strong>${esc(d.requestCode)}</strong>.`;
      const label = es ? 'Ver estado' : 'View status';
      const text = es
        ? `Solicitud de eliminación recibida. Código: ${d.requestCode}. Estado: ${d.statusUrl}`
        : `Data deletion request received. Code: ${d.requestCode}. Status: ${d.statusUrl}`;
      return {
        subject,
        html: wrap(subject, `<p>${intro}</p>${button(d.statusUrl, label)}`),
        text,
      };
    }
    case 'generic_notification': {
      const d = data as TemplateData['generic_notification'];
      const cta =
        d.ctaUrl && d.ctaLabel ? button(d.ctaUrl, d.ctaLabel) : '';
      const text = `${d.title}\n\n${d.body}${d.ctaUrl ? `\n\n${d.ctaUrl}` : ''}`;
      return {
        subject: d.title,
        html: wrap(d.title, `<p>${esc(d.body)}</p>${cta}`),
        text,
      };
    }
    default: {
      const _exhaustive: never = template;
      throw new Error(`Unknown email template: ${_exhaustive as string}`);
    }
  }
}
